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
  const point = historyPoint(account, def, defs, now, hours);
  const resetsAt = readingAt(account, def.id, now)?.resetsAt ?? null;
  if (!point || point.blockedBy || resetsAt === null || resetsAt <= now) return null;
  const remaining = usableRemaining(point);
  if (remaining <= EMPTY_PERCENT) return null;
  const hoursLeft = (resetsAt - now) / HOUR_MS;
  const needed = remaining / hoursLeft;
  if (point.drain <= IDLE_RATE) return { kind: 'needs', needed, multiplier: null };
  const multiplier = needed / point.drain;
  const limit = defs.find((other) => {
    if (!canBlock(other, def)) return false;
    const reading = readingAt(account, other.id, now);
    if (!reading) return false;
    const until =
      reading.resetsAt === null
        ? hoursLeft
        : Math.min(hoursLeft, (reading.resetsAt - now) / HOUR_MS);
    const spent = burnRate(account, other.id, now, hours) * multiplier * until;
    return spent > 100 - reading.usedPercent;
  });
  return limit ? { kind: 'runsOutFirst', window: limit.id } : { kind: 'needs', needed, multiplier };
}

export type UseAll =
  | { kind: 'pace'; needed: number; multiplier: number | null }
  | { kind: 'outOfReach'; window: string; multiplier: number | null }
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

const MAX_SEARCHES = 24;

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
  for (let search = 0; search < MAX_SEARCHES; search += 1) {
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
  rateAt: (def: WindowDef, at: number) => number;
  strategy: RoutingStrategy;
  dry: DryAbove;
}

interface Contributor {
  key: string;
  resetsAt: number;
}

function blockedWithinCycle(
  input: PoolHeadroomInput,
  multiplier: number,
  contributors: readonly Contributor[]
): string | null {
  const { accounts, def, defs, now, rateAt, strategy } = input;
  const end = Math.max(...contributors.map((contributor) => contributor.resetsAt));
  const projection = project(accounts, defs, now, (other, at) => rateAt(other, at) * multiplier, {
    strategy,
    horizon: end - now,
  });
  for (const { key, resetsAt } of contributors) {
    const last = Math.floor((resetsAt - now) / projection.step);
    const points =
      projection.accounts
        .get(key)
        ?.get(def.id)
        ?.slice(0, last + 1) ?? [];
    const blocker = points.find((point) => point?.blockedBy)?.blockedBy;
    if (blocker) return blocker;
  }
  return null;
}

export function poolHeadroom(input: PoolHeadroomInput): PoolHeadroom {
  const { accounts, def, defs, now, hours, burn, dry } = input;
  const due = accounts.flatMap((account) => {
    const resetsAt = readingAt(account, def.id, now)?.resetsAt ?? null;
    return resetsAt !== null && resetsAt > now ? [{ account, resetsAt }] : [];
  });
  const rooms = due.map(({ account, resetsAt }) => ({
    key: account.key,
    resetsAt,
    room: accountHeadroom(account, def, defs, now, hours),
  }));
  const contributors = rooms.filter(({ room }) => room?.kind === 'needs');
  const needed = contributors.reduce(
    (sum, { room }) => (room?.kind === 'needs' ? sum + room.needed : sum),
    0
  );
  const firstOut = rooms.find(({ room }) => room?.kind === 'runsOutFirst')?.room;
  const multiplier = burn > IDLE_RATE ? needed / burn : null;
  const outOfReach = (window: string): UseAll => ({
    kind: 'outOfReach',
    window,
    multiplier: dry.kind === 'at' && dry.window === window ? dry.multiplier : null,
  });
  const blocker =
    needed > IDLE_RATE && multiplier !== null
      ? blockedWithinCycle(input, multiplier, contributors)
      : null;
  const useAll: UseAll =
    due.length === 0
      ? { kind: 'nothingDue' }
      : blocker
        ? outOfReach(blocker)
        : needed > IDLE_RATE
          ? { kind: 'pace', needed, multiplier }
          : firstOut?.kind === 'runsOutFirst'
            ? outOfReach(firstOut.window)
            : { kind: 'allUsed' };
  return { useAll, dryAbove: dry };
}
