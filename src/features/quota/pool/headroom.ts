import {
  EMPTY_PERCENT,
  HOUR_MS,
  burnRate,
  canBlock,
  historyPoint,
  readingAt,
  usableRemaining,
  type BurnHours,
  type PoolAccount,
  type WindowDef,
} from './model';

const IDLE_RATE = 0.05;

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
