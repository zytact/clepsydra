import type { RoutingStrategy } from '@/types/routing';
import {
  EMPTY_PERCENT,
  HOUR_MS,
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
  | { kind: 'usedUp' }
  | { kind: 'notDue' };

function windowState(
  { def, defs, now, hours }: HeadroomScope,
  account: PoolAccount
): WindowState | null {
  const point = historyPoint(account, def, defs, now, hours);
  if (!point) return null;
  if (point.blockedBy) {
    return { kind: 'blocked', window: point.blockedBy, remaining: point.remaining };
  }
  const resetsAt = readingAt(account, def.id, now)?.resetsAt ?? null;
  if (resetsAt === null || resetsAt <= now) return { kind: 'notDue' };
  const remaining = usableRemaining(point);
  if (remaining <= EMPTY_PERCENT) return { kind: 'usedUp' };
  const hoursLeft = (resetsAt - now) / HOUR_MS;
  return {
    kind: 'counted',
    counted: {
      account,
      needed: (remaining - EMPTY_PERCENT) / hoursLeft,
      burn: point.drain,
      hoursLeft,
    },
  };
}

export interface HeadroomScope {
  accounts: readonly PoolAccount[];
  def: WindowDef;
  defs: readonly WindowDef[];
  now: number;
  hours: BurnHours;
}

function spendRatio(
  { accounts, def, now, hours }: HeadroomScope,
  account: PoolAccount,
  other: WindowDef
): number | null {
  const sample =
    burnRate(account, def.id, now, hours) > IDLE_RATE
      ? [account]
      : accounts.filter(
          (entry) => readingAt(entry, def.id, now) && readingAt(entry, other.id, now)
        );
  const total = (id: string) =>
    sample.reduce((sum, entry) => sum + burnRate(entry, id, now, hours), 0);
  const onDef = total(def.id);
  return onDef > IDLE_RATE ? total(other.id) / onDef : null;
}

function runsOutFirst(
  scope: HeadroomScope,
  { account, needed, hoursLeft }: Counted
): string | null {
  const { def, defs, now } = scope;
  const limit = defs.find((other) => {
    if (!canBlock(other, def)) return false;
    const reading = readingAt(account, other.id, now);
    const ratio = reading ? spendRatio(scope, account, other) : null;
    if (!reading || ratio === null) return false;
    const until =
      reading.resetsAt === null
        ? hoursLeft
        : Math.min(hoursLeft, (reading.resetsAt - now) / HOUR_MS);
    return needed * ratio * until >= 100 - reading.usedPercent - EMPTY_PERCENT;
  });
  return limit?.id ?? null;
}

export type AccountHeadroom =
  | { kind: 'needs'; needed: number; multiplier: number | null }
  | { kind: 'runsOutFirst'; window: string };

export function accountHeadroom(
  scope: HeadroomScope,
  account: PoolAccount
): AccountHeadroom | null {
  const state = windowState(scope, account);
  if (state?.kind !== 'counted') return null;
  const { needed, burn } = state.counted;
  const multiplier = burn > IDLE_RATE ? needed / burn : null;
  const window =
    runsOutFirst(scope, state.counted) ??
    (multiplier === null ? null : slowerLimit(scope, account, multiplier));
  if (window) return { kind: 'runsOutFirst', window };
  return { kind: 'needs', needed, multiplier };
}

function accountPace(scope: HeadroomScope, account: PoolAccount): number | null {
  const state = windowState(scope, account);
  if (state?.kind !== 'counted' || state.counted.burn <= IDLE_RATE) return null;
  return state.counted.needed / state.counted.burn;
}

function slowerLimit(
  scope: HeadroomScope,
  account: PoolAccount,
  multiplier: number
): string | null {
  const limit = scope.defs.find((other) => {
    if (!canBlock(other, scope.def)) return false;
    const pace = accountPace({ ...scope, def: other }, account);
    return pace !== null && pace < multiplier;
  });
  return limit?.id ?? null;
}

export type UseAll =
  | { kind: 'pace'; needed: number; multiplier: number | null }
  | { kind: 'capped'; multiplier: number; window: string }
  | { kind: 'outOfReach'; window: string }
  | { kind: 'blocked'; window: string }
  | { kind: 'allUsed' }
  | { kind: 'nothingDue' };

export type DryAbove = { kind: 'never' } | { kind: 'already' } | { kind: 'at'; multiplier: number };

export interface PoolHeadroom {
  useAll: UseAll;
  dryAbove: DryAbove;
}

export interface DrySearchInput {
  accounts: readonly PoolAccount[];
  defs: readonly WindowDef[];
  now: number;
  burns: ReadonlyMap<string, number>;
  strategy: RoutingStrategy;
  current: Projection;
}

const SEARCHES_PER_WINDOW = 16;
interface Bracket {
  low: number;
  high: number;
}

const isOpen = ({ low, high }: Bracket) => high - low > 0.04 * high;
const spread = ({ low, high }: Bracket) => (low === 0 ? Infinity : high / low);

function emptied(input: DrySearchInput, multiplier: number): Set<string> {
  const { accounts, defs, now, burns, strategy } = input;
  const projection = project(
    accounts,
    defs,
    now,
    { routed: (def) => (burns.get(def.id) ?? 0) * multiplier, own: () => 0 },
    { strategy }
  );
  return new Set(
    defs
      .filter(
        (def) =>
          (windowStats(accounts, def, projection, burns.get(def.id) ?? 0).routing?.poolEmptyAt ??
            null) !== null
      )
      .map((def) => def.id)
  );
}

export function dryAbove(input: DrySearchInput): Map<string, DryAbove> {
  const { accounts, defs, now, burns, current } = input;
  const emptyNow = new Set(
    defs
      .filter(
        (def) =>
          windowStats(accounts, def, current, burns.get(def.id) ?? 0).routing?.poolEmptyAt === now
      )
      .map((def) => def.id)
  );
  const flat = emptied(input, MAX_MULTIPLIER);
  const brackets = new Map<string, Bracket>(
    defs
      .filter((def) => !emptyNow.has(def.id) && flat.has(def.id))
      .map((def) => [def.id, { low: 0, high: MAX_MULTIPLIER }])
  );
  const searches = SEARCHES_PER_WINDOW * brackets.size;
  for (let search = 0; search < searches; search += 1) {
    const widest = [...brackets.values()].filter(isOpen).sort((a, b) => spread(b) - spread(a))[0];
    if (!widest) break;
    const middle =
      widest.low === 0 ? Math.min(1, widest.high / 2) : Math.sqrt(widest.low * widest.high);
    const dry = emptied(input, middle);
    for (const [id, bracket] of brackets) {
      if (dry.has(id) && middle < bracket.high) brackets.set(id, { ...bracket, high: middle });
      if (!dry.has(id) && middle > bracket.low) brackets.set(id, { ...bracket, low: middle });
    }
  }
  return new Map(
    defs.map((def): [string, DryAbove] => {
      const bracket = brackets.get(def.id);
      if (emptyNow.has(def.id)) return [def.id, { kind: 'already' }];
      return [
        def.id,
        bracket
          ? { kind: 'at', multiplier: bracket.low > 0 ? bracket.low : bracket.high }
          : { kind: 'never' },
      ];
    })
  );
}

function fullUse(scope: HeadroomScope, burn: number): UseAll {
  const states = scope.accounts.flatMap((account) => {
    const state = windowState(scope, account);
    return state ? [state] : [];
  });
  if (states.length === 0) return { kind: 'nothingDue' };
  const counted = states.flatMap((state) => (state.kind === 'counted' ? [state.counted] : []));
  if (counted.length === 0) {
    const blocked = states.find(
      (state): state is Extract<WindowState, { kind: 'blocked' }> =>
        state.kind === 'blocked' && state.remaining > EMPTY_PERCENT
    );
    if (blocked) return { kind: 'blocked', window: blocked.window };
    return states.some((state) => state.kind === 'notDue')
      ? { kind: 'nothingDue' }
      : { kind: 'allUsed' };
  }
  const needed = counted.reduce((sum, entry) => sum + entry.needed, 0);
  const window = counted
    .map((entry) => runsOutFirst(scope, entry))
    .find((id): id is string => id !== null);
  if (window) return { kind: 'outOfReach', window };
  return { kind: 'pace', needed, multiplier: burn > IDLE_RATE ? needed / burn : null };
}

const paceOf = (use: UseAll | undefined): number | null =>
  use?.kind === 'capped' || use?.kind === 'pace' ? use.multiplier : null;

export function fullUseByWindow(
  scope: Omit<HeadroomScope, 'def'>,
  burns: ReadonlyMap<string, number>
): Map<string, UseAll> {
  const blockersFirst = [...scope.defs].sort(
    (a, b) => b.windowMs - a.windowMs || Number(b.scope === 'all') - Number(a.scope === 'all')
  );
  const uses = new Map<string, UseAll>();
  for (const def of blockersFirst) {
    const own = fullUse({ ...scope, def }, burns.get(def.id) ?? 0);
    const ownPace = own.kind === 'outOfReach' ? Infinity : paceOf(own);
    const limit = scope.defs
      .filter((other) => canBlock(other, def))
      .map((other) => ({ other, pace: paceOf(uses.get(other.id)) }))
      .filter(
        (entry): entry is { other: WindowDef; pace: number } =>
          ownPace !== null && entry.pace !== null && entry.pace < ownPace
      )
      .sort((a, b) => a.pace - b.pace)[0];
    const limitUse = limit ? uses.get(limit.other.id) : undefined;
    uses.set(
      def.id,
      limit
        ? {
            kind: 'capped',
            multiplier: limit.pace,
            window: limitUse?.kind === 'capped' ? limitUse.window : limit.other.id,
          }
        : own
    );
  }
  return uses;
}
