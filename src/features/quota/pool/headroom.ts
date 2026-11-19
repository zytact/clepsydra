import type { RoutingStrategy } from '@/types/routing';
import {
  EMPTY_PERCENT,
  HOUR_MS,
  STEP_MS,
  burnRate,
  canBlock,
  historyPoint,
  project,
  readingAt,
  usableRemaining,
  windowStats,
  type BurnHours,
  type PoolAccount,
  type Projection,
  type WindowDef,
} from './model';

const IDLE_RATE = 0.05;
const MAX_MULTIPLIER = 40;

interface Counted {
  account: PoolAccount;
  needed: number;
  burn: number;
  hoursLeft: number;
}

type WindowState =
  | { kind: 'counted'; counted: Counted }
  | { kind: 'blocked'; window: string; remaining: number }
  | { kind: 'usedUp' };

function windowState(
  account: PoolAccount,
  def: WindowDef,
  defs: readonly WindowDef[],
  now: number,
  hours: BurnHours
): WindowState | null {
  const point = historyPoint(account, def, defs, now, hours);
  const resetsAt = readingAt(account, def.id, now)?.resetsAt ?? null;
  if (!point || resetsAt === null || resetsAt <= now) return null;
  if (point.blockedBy) {
    return { kind: 'blocked', window: point.blockedBy, remaining: point.remaining };
  }
  const remaining = usableRemaining(point);
  if (remaining <= EMPTY_PERCENT) return { kind: 'usedUp' };
  const hoursLeft = (resetsAt - now) / HOUR_MS;
  return {
    kind: 'counted',
    counted: { account, needed: remaining / hoursLeft, burn: point.drain, hoursLeft },
  };
}

function runsOutFirst(
  { account, hoursLeft }: Counted,
  def: WindowDef,
  defs: readonly WindowDef[],
  now: number,
  hours: BurnHours,
  multiplier: number
): string | null {
  const limit = defs.find((other) => {
    if (!canBlock(other, def)) return false;
    const reading = readingAt(account, other.id, now);
    if (!reading) return false;
    const until =
      reading.resetsAt === null
        ? hoursLeft
        : Math.min(hoursLeft, (reading.resetsAt - now) / HOUR_MS);
    const spent = burnRate(account, other.id, now, hours) * multiplier * until;
    return spent >= 100 - reading.usedPercent - EMPTY_PERCENT;
  });
  return limit?.id ?? null;
}

export type AccountHeadroom =
  | { kind: 'needs'; needed: number; multiplier: number | null }
  | { kind: 'runsOutFirst'; window: string };

export function accountHeadroom(
  account: PoolAccount,
  def: WindowDef,
  defs: readonly WindowDef[],
  now: number,
  hours: BurnHours
): AccountHeadroom | null {
  const state = windowState(account, def, defs, now, hours);
  if (state?.kind !== 'counted') return null;
  const { needed, burn } = state.counted;
  if (burn <= IDLE_RATE) return { kind: 'needs', needed, multiplier: null };
  const multiplier = needed / burn;
  const window = runsOutFirst(state.counted, def, defs, now, hours, multiplier);
  return window ? { kind: 'runsOutFirst', window } : { kind: 'needs', needed, multiplier };
}

export type UseAll =
  | { kind: 'pace'; needed: number; multiplier: number | null }
  | { kind: 'outOfReach'; window: string }
  | { kind: 'blocked'; window: string }
  | { kind: 'allUsed' }
  | { kind: 'nothingDue' };

export type DryAbove =
  { kind: 'never' } | { kind: 'already' } | { kind: 'at'; multiplier: number; window: string };

export interface PoolHeadroom {
  useAll: UseAll;
  dryAbove: DryAbove;
}

export interface DrySearchInput {
  accounts: readonly PoolAccount[];
  defs: readonly WindowDef[];
  now: number;
  burns: ReadonlyMap<string, number>;
  rateAt: (def: WindowDef, at: number) => number;
  strategy: RoutingStrategy;
  current: Projection;
}

const SEARCHES_PER_WINDOW = 16;
export const DRY_STEP_MS = STEP_MS;

interface Bracket {
  low: number;
  high: number;
  window: string;
}

const isOpen = ({ low, high }: Bracket) => high - low > Math.max(0.05, 0.04 * high);
const spread = ({ low, high }: Bracket) => (low === 0 ? Infinity : high / low);

function emptiedAt(input: DrySearchInput, multiplier: number): Map<string, string | null> {
  const { accounts, defs, now, burns, rateAt, strategy } = input;
  const projection = project(accounts, defs, now, (def, at) => rateAt(def, at) * multiplier, {
    strategy,
    step: DRY_STEP_MS,
  });
  return new Map(
    defs.map((def) => {
      const emptyAt = windowStats(accounts, def, projection, burns.get(def.id) ?? 0).poolEmptyAt;
      if (emptyAt === null) return [def.id, null];
      const index = Math.round((emptyAt - now) / projection.step);
      const blocker = accounts
        .map((account) => projection.accounts.get(account.key)?.get(def.id)?.[index]?.blockedBy)
        .find((id): id is string => typeof id === 'string');
      return [def.id, blocker ?? def.id];
    })
  );
}

export function dryAbove(input: DrySearchInput): Map<string, DryAbove> {
  const { accounts, defs, now, burns, current } = input;
  const emptyNow = new Set(
    defs
      .filter(
        (def) => windowStats(accounts, def, current, burns.get(def.id) ?? 0).poolEmptyAt === now
      )
      .map((def) => def.id)
  );
  const flat = emptiedAt(input, MAX_MULTIPLIER);
  const brackets = new Map<string, Bracket>(
    defs.flatMap((def): [string, Bracket][] => {
      const window = flat.get(def.id);
      return !emptyNow.has(def.id) && window
        ? [[def.id, { low: 0, high: MAX_MULTIPLIER, window }]]
        : [];
    })
  );
  const searches = SEARCHES_PER_WINDOW * brackets.size;
  for (let search = 0; search < searches; search += 1) {
    const widest = [...brackets.values()].filter(isOpen).sort((a, b) => spread(b) - spread(a))[0];
    if (!widest) break;
    const middle =
      widest.low === 0 ? Math.min(1, widest.high / 2) : Math.sqrt(widest.low * widest.high);
    const emptied = emptiedAt(input, middle);
    for (const [id, bracket] of brackets) {
      const window = emptied.get(id);
      if (window && middle < bracket.high) brackets.set(id, { ...bracket, high: middle, window });
      if (!window && middle > bracket.low) brackets.set(id, { ...bracket, low: middle });
    }
  }
  return new Map(
    defs.map((def): [string, DryAbove] => {
      const bracket = brackets.get(def.id);
      if (emptyNow.has(def.id)) return [def.id, { kind: 'already' }];
      return [
        def.id,
        bracket
          ? { kind: 'at', multiplier: bracket.low, window: bracket.window }
          : { kind: 'never' },
      ];
    })
  );
}

export interface PoolHeadroomInput {
  accounts: readonly PoolAccount[];
  def: WindowDef;
  defs: readonly WindowDef[];
  now: number;
  hours: BurnHours;
  burn: number;
  dry: DryAbove;
}

function fullUseOf(
  { def, defs, now, hours, burn }: PoolHeadroomInput,
  states: readonly WindowState[]
): UseAll {
  if (states.length === 0) return { kind: 'nothingDue' };
  const counted = states.flatMap((state) => (state.kind === 'counted' ? [state.counted] : []));
  if (counted.length === 0) {
    const blocked = states.find(
      (state): state is Extract<WindowState, { kind: 'blocked' }> =>
        state.kind === 'blocked' && state.remaining > EMPTY_PERCENT
    );
    return blocked ? { kind: 'blocked', window: blocked.window } : { kind: 'allUsed' };
  }
  const needed = counted.reduce((sum, entry) => sum + entry.needed, 0);
  if (burn <= IDLE_RATE) return { kind: 'pace', needed, multiplier: null };
  const multiplier = needed / burn;
  const window = counted
    .map((entry) => runsOutFirst(entry, def, defs, now, hours, multiplier))
    .find((id): id is string => id !== null);
  return window ? { kind: 'outOfReach', window } : { kind: 'pace', needed, multiplier };
}

export function poolHeadroom(input: PoolHeadroomInput): PoolHeadroom {
  const { accounts, def, defs, now, hours, dry } = input;
  const states = accounts.flatMap((account) => {
    const state = windowState(account, def, defs, now, hours);
    return state ? [state] : [];
  });
  return { useAll: fullUseOf(input, states), dryAbove: dry };
}
