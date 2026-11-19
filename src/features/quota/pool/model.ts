import type { RoutingStrategy } from '@/types/routing';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const STEP_MS = 10 * MINUTE_MS;
export const PROJECTION_MS = 14 * DAY_MS;
export const EMPTY_PERCENT = 0.5;
export const USUAL_BAND = 2.5;
export const RESET_GAIN_PERCENT = 3;
const LEARNED_SPAN_MS = DAY_MS;

export type WindowScope = 'all' | 'model';
export const BURN_HOURS = [1, 3, 6] as const;
export type BurnHours = (typeof BURN_HOURS)[number];
export type FutureUsage = 'same' | 'usual' | 'stop';

export interface WindowReading {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  windowMs: number;
  scope: WindowScope;
}

export interface AccountSample {
  at: number;
  windows: WindowReading[];
}

export interface PoolAccount {
  key: string;
  label: string;
  priority: number;
  weight: number;
  samples: AccountSample[];
}

export type RouteSlot = Pick<PoolAccount, 'key' | 'priority' | 'weight'>;

export function routeShares(
  strategy: RoutingStrategy,
  ready: readonly RouteSlot[]
): Map<string, number> {
  if (ready.length === 0) return new Map();
  const top = Math.max(...ready.map((slot) => slot.priority));
  const tier = ready.filter((slot) => slot.priority === top);
  if (strategy === 'fill-first') {
    const first = tier.reduce((best, slot) => (slot.key < best.key ? slot : best));
    return new Map([[first.key, 1]]);
  }
  if (strategy === 'round-robin') return new Map(tier.map((slot) => [slot.key, 1 / tier.length]));
  const weighted = tier.filter((slot) => slot.weight > 0);
  const total = weighted.reduce((sum, slot) => sum + slot.weight, 0);
  return new Map(weighted.map((slot) => [slot.key, slot.weight / total]));
}

export interface WindowDef {
  id: string;
  label: string;
  windowMs: number;
  scope: WindowScope;
}

export interface WindowPoint {
  remaining: number;
  blockedBy: string | null;
  drain: number;
}

export interface AccountSeries {
  key: string;
  label: string;
  points: (WindowPoint | null)[];
}

export interface Projection {
  start: number;
  step: number;
  accounts: Map<string, Map<string, (WindowPoint | null)[]>>;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
export const usableRemaining = (point: WindowPoint | null) =>
  point && !point.blockedBy ? point.remaining : 0;

function isPoolEmpty(points: readonly (WindowPoint | null)[]): boolean {
  const present = points.filter((point) => point !== null);
  return present.length > 0 && present.every((point) => usableRemaining(point) <= EMPTY_PERCENT);
}

export function windowDefs(accounts: readonly PoolAccount[]): WindowDef[] {
  const defs = new Map<string, WindowDef>();
  for (const account of accounts) {
    for (const sample of account.samples) {
      for (const window of sample.windows) {
        defs.set(window.id, {
          id: window.id,
          label: window.label,
          windowMs: window.windowMs,
          scope: window.scope,
        });
      }
    }
  }
  return [...defs.values()].sort(
    (a, b) =>
      Number(a.scope === 'model') - Number(b.scope === 'model') ||
      a.windowMs - b.windowMs ||
      a.label.localeCompare(b.label)
  );
}

function sampleIndexAt(samples: readonly AccountSample[], at: number): number {
  let low = 0;
  let high = samples.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (samples[middle].at <= at) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export function readingAt(account: PoolAccount, id: string, at: number): WindowReading | null {
  const index = sampleIndexAt(account.samples, at);
  if (index === -1) return null;
  const window = account.samples[index].windows.find((candidate) => candidate.id === id);
  if (!window) return null;
  if (window.resetsAt !== null && window.resetsAt <= at) {
    return { ...window, usedPercent: 0, resetsAt: null };
  }
  return window;
}

export function blockerOf(
  def: WindowDef,
  defs: readonly WindowDef[],
  remainingOf: (id: string) => number | null
): string | null {
  const blocker = defs.find((other) => {
    if (other.id === def.id || other.scope !== 'all') return false;
    const longer =
      other.windowMs > def.windowMs || (def.scope === 'model' && other.windowMs >= def.windowMs);
    if (!longer) return false;
    const remaining = remainingOf(other.id);
    return remaining !== null && remaining <= EMPTY_PERCENT;
  });
  return blocker?.id ?? null;
}

export function drainBetween(account: PoolAccount, id: string, from: number, to: number): number {
  let spent = 0;
  let previous: number | null = null;
  const samples = account.samples;
  for (let index = Math.max(0, sampleIndexAt(samples, from)); index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.at > to) break;
    const window = sample.windows.find((candidate) => candidate.id === id);
    if (!window) continue;
    if (previous !== null && sample.at > from && window.usedPercent > previous) {
      spent += window.usedPercent - previous;
    }
    previous = window.usedPercent;
  }
  return spent;
}

export function burnRate(account: PoolAccount, id: string, now: number, hours: BurnHours): number {
  return drainBetween(account, id, now - hours * HOUR_MS, now) / hours;
}

export function poolBurnRate(
  accounts: readonly PoolAccount[],
  id: string,
  now: number,
  hours: BurnHours
): number {
  return accounts.reduce((sum, account) => sum + burnRate(account, id, now, hours), 0);
}

export function historyPoint(
  account: PoolAccount,
  def: WindowDef,
  defs: readonly WindowDef[],
  at: number,
  hours: BurnHours
): WindowPoint | null {
  const reading = readingAt(account, def.id, at);
  if (!reading) return null;
  const blockedBy = blockerOf(def, defs, (id) => {
    const other = readingAt(account, id, at);
    return other ? 100 - other.usedPercent : null;
  });
  return {
    remaining: clamp(100 - reading.usedPercent),
    blockedBy,
    drain: burnRate(account, def.id, at, hours),
  };
}

export type UsualProfile = number[] | null;

export function usualProfile(
  accounts: readonly PoolAccount[],
  id: string,
  now: number
): UsualProfile {
  const first = Math.min(
    ...accounts.flatMap((account) =>
      account.samples
        .filter((sample) => sample.windows.some((window) => window.id === id))
        .slice(0, 1)
        .map((sample) => sample.at)
    )
  );
  if (!Number.isFinite(first) || now - first < LEARNED_SPAN_MS) return null;
  const spent = new Array<number>(24).fill(0);
  for (const account of accounts) {
    let previous: AccountSample | null = null;
    for (const sample of account.samples) {
      const window = sample.windows.find((candidate) => candidate.id === id);
      if (!window) continue;
      const before = previous?.windows.find((candidate) => candidate.id === id);
      if (previous && before && window.usedPercent > before.usedPercent) {
        spent[new Date(sample.at).getHours()] += window.usedPercent - before.usedPercent;
      }
      previous = sample;
    }
  }
  const days = Math.max(1, (now - first) / DAY_MS);
  return spent.map((total) => total / days);
}

export const usualAt = (profile: number[], at: number) => profile[new Date(at).getHours()];

interface SimState {
  used: number;
  resetsAt: number | null;
}

export interface ProjectOptions {
  strategy?: RoutingStrategy;
  horizon?: number;
  step?: number;
}

export function project(
  accounts: readonly PoolAccount[],
  defs: readonly WindowDef[],
  now: number,
  rateAt: (def: WindowDef, at: number) => number,
  { strategy = 'round-robin', horizon = PROJECTION_MS, step = STEP_MS }: ProjectOptions = {}
): Projection {
  const states = new Map<string, Map<string, SimState>>();
  for (const account of accounts) {
    const windows = new Map<string, SimState>();
    for (const def of defs) {
      const reading = readingAt(account, def.id, now);
      if (reading) windows.set(def.id, { used: reading.usedPercent, resetsAt: reading.resetsAt });
    }
    if (windows.size > 0) states.set(account.key, windows);
  }

  const series = new Map<string, Map<string, (WindowPoint | null)[]>>();
  for (const key of states.keys()) {
    series.set(key, new Map(defs.map((def) => [def.id, [] as (WindowPoint | null)[]])));
  }
  const steps = Math.ceil(horizon / step);
  const stepHours = step / HOUR_MS;

  for (let index = 0; index <= steps; index += 1) {
    const at = now + index * step;
    if (index > 0) {
      for (const windows of states.values()) {
        for (const state of windows.values()) {
          if (state.resetsAt !== null && at >= state.resetsAt) {
            state.used = 0;
            state.resetsAt = null;
          }
        }
      }
    }

    const blocked = new Map<string, Map<string, string | null>>();
    for (const [key, windows] of states) {
      const remainingOf = (id: string) => {
        const state = windows.get(id);
        return state ? 100 - state.used : null;
      };
      blocked.set(key, new Map(defs.map((def) => [def.id, blockerOf(def, defs, remainingOf)])));
    }
    const routable = accounts.filter((account) => {
      const windows = states.get(account.key);
      return (
        windows !== undefined &&
        defs.every(
          (def) => def.scope !== 'all' || (windows.get(def.id)?.used ?? 0) < 100 - EMPTY_PERCENT
        )
      );
    });

    const drains = new Map<string, Map<string, number>>();
    if (index > 0) {
      for (const def of defs) {
        const ready = (account: PoolAccount) => {
          const state = states.get(account.key)?.get(def.id);
          return state !== undefined && state.used < 100 - EMPTY_PERCENT;
        };
        let users = routable.filter(ready);
        let demand = rateAt(def, at) * stepHours;
        while (demand > 0 && users.length > 0) {
          let spilled = 0;
          for (const [key, share] of routeShares(strategy, users)) {
            const state = states.get(key)?.get(def.id);
            const wanted = demand * share;
            if (!state || wanted <= 0) continue;
            const taken = Math.min(wanted, 100 - state.used);
            spilled += wanted - taken;
            state.used += taken;
            if (state.resetsAt === null) state.resetsAt = at + def.windowMs;
            const perAccount = drains.get(key) ?? new Map<string, number>();
            perAccount.set(def.id, (perAccount.get(def.id) ?? 0) + taken / stepHours);
            drains.set(key, perAccount);
          }
          demand = spilled;
          users = users.filter(ready);
        }
      }
    }

    for (const [key, windows] of states) {
      for (const def of defs) {
        const state = windows.get(def.id);
        const points = series.get(key)?.get(def.id);
        if (!points) continue;
        points.push(
          state
            ? {
                remaining: clamp(100 - state.used),
                blockedBy: blocked.get(key)?.get(def.id) ?? null,
                drain: drains.get(key)?.get(def.id) ?? 0,
              }
            : null
        );
      }
    }
  }

  return { start: now, step, accounts: series };
}

export function projectedPoint(
  projection: Projection,
  key: string,
  id: string,
  at: number
): WindowPoint | null {
  const points = projection.accounts.get(key)?.get(id);
  if (!points || at < projection.start) return null;
  const index = Math.round((at - projection.start) / projection.step);
  return points[Math.min(index, points.length - 1)] ?? null;
}

export interface WindowStats {
  current: number;
  total: number;
  burn: number;
  poolEmptyAt: number | null;
  firstEmpty: { key: string; at: number } | null;
  nextReset: { at: number; gain: number } | null;
}

export function windowStats(
  accounts: readonly PoolAccount[],
  def: WindowDef,
  projection: Projection,
  burn: number
): WindowStats {
  const keys = accounts
    .map((account) => account.key)
    .filter((key) => (projection.accounts.get(key)?.get(def.id)?.[0] ?? null) !== null);
  const pointsOf = (key: string) => projection.accounts.get(key)?.get(def.id) ?? [];
  const length = Math.max(0, ...keys.map((key) => pointsOf(key).length));
  const usableAt = (key: string, index: number) => usableRemaining(pointsOf(key)[index] ?? null);
  const open = keys.filter((key) => !pointsOf(key)[0]?.blockedBy);

  let poolEmptyAt: number | null = null;
  for (let index = 0; index < length; index += 1) {
    if (isPoolEmpty(keys.map((key) => pointsOf(key)[index] ?? null))) {
      poolEmptyAt = projection.start + index * projection.step;
      break;
    }
  }

  let firstEmpty: WindowStats['firstEmpty'] = null;
  for (const key of open) {
    const index = pointsOf(key).findIndex((point) => usableRemaining(point) <= EMPTY_PERCENT);
    const at = projection.start + index * projection.step;
    if (index >= 0 && (!firstEmpty || at < firstEmpty.at)) firstEmpty = { key, at };
  }

  const resets = accounts.flatMap((account) => {
    if (!open.includes(account.key)) return [];
    const at = readingAt(account, def.id, projection.start)?.resetsAt ?? null;
    return at === null ? [] : [{ key: account.key, at }];
  });
  const resetGain = (key: string, index: number) => {
    if (index < length) return Math.max(0, usableAt(key, index) - usableAt(key, index - 1));
    return pointsOf(key)[length - 1]?.blockedBy ? 0 : 100 - usableAt(key, length - 1);
  };
  let nextReset: WindowStats['nextReset'] = null;
  if (resets.length > 0) {
    const at = Math.min(...resets.map((reset) => reset.at));
    const index = Math.ceil((at - projection.start) / projection.step);
    const gain = resets
      .filter((reset) => reset.at === at)
      .reduce((sum, { key }) => sum + resetGain(key, index), 0);
    nextReset = { at, gain };
  }

  return {
    current: open.reduce((sum, key) => sum + usableAt(key, 0), 0),
    total: open.length * 100,
    burn,
    poolEmptyAt,
    firstEmpty,
    nextReset,
  };
}

export interface BlockedNotice {
  key: string;
  blockedBy: string;
  until: number | null;
}

export function blockedNotices(
  accounts: readonly PoolAccount[],
  defs: readonly WindowDef[],
  projection: Projection
): BlockedNotice[] {
  return accounts.flatMap((account) => {
    const byWindow = projection.accounts.get(account.key);
    if (!byWindow) return [];
    const blocker = defs
      .map((def) => byWindow.get(def.id)?.[0]?.blockedBy ?? null)
      .find((id): id is string => id !== null);
    if (!blocker) return [];
    const index = (byWindow.get(blocker) ?? []).findIndex(
      (point) => point !== null && point.remaining > EMPTY_PERCENT
    );
    const until = index > 0 ? projection.start + index * projection.step : null;
    return [{ key: account.key, blockedBy: blocker, until }];
  });
}

export interface ChartEvent {
  at: number;
  gain: number;
  blocked: string[];
  back: string[];
}

export function chartEvents(
  times: readonly number[],
  series: readonly AccountSeries[]
): ChartEvent[] {
  const events: ChartEvent[] = [];
  for (let index = 1; index < times.length; index += 1) {
    let gain = 0;
    const blocked: string[] = [];
    const back: string[] = [];
    for (const account of series) {
      const previous = account.points[index - 1];
      const current = account.points[index];
      if (!previous || !current) continue;
      const delta = usableRemaining(current) - usableRemaining(previous);
      if (delta >= RESET_GAIN_PERCENT) gain += delta;
      if (!previous.blockedBy && current.blockedBy) blocked.push(account.label);
      if (previous.blockedBy && !current.blockedBy) back.push(account.label);
    }
    if (gain >= RESET_GAIN_PERCENT || blocked.length > 0 || back.length > 0) {
      events.push({ at: times[index], gain, blocked, back });
    }
  }
  return events;
}
