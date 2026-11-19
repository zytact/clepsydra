import {
  DAY_MS,
  HOUR_MS,
  PROJECTION_MS,
  USUAL_BAND,
  STEP_MS,
  chartEvents,
  demandFor,
  historyPoint,
  poolBurnRate,
  project,
  projectedPoint,
  usableRemaining,
  usualAt,
  usualProfile,
  windowDefs,
  windowStats,
  blockedNotices,
  type AccountSeries,
  type BurnHours,
  type ChartEvent,
  type FutureUsage,
  type PoolAccount,
  type Projection,
  type UsualProfile,
  type WindowDef,
  type WindowStats,
  type BlockedNotice,
} from './model';
import type { RoutingStrategy } from '@/types/routing';
import { dryAbove, fullUseByWindow, type PoolHeadroom } from './headroom';

export const HISTORY_MS = 15 * DAY_MS;
export const OFFSET_LIMITS = { min: -4, max: 4 } as const;

export type ChartMode = 'remaining' | 'drain';

export interface PoolUi {
  mode: ChartMode;
  burn: BurnHours;
  future: FutureUsage;
  stacked: boolean;
  offset: number;
}

export interface PoolWindowView {
  def: WindowDef;
  stats: WindowStats;
  usual: UsualProfile;
  headroom: PoolHeadroom | null;
}

export interface ProviderPoolView {
  accounts: PoolAccount[];
  defs: WindowDef[];
  projection: Projection;
  windows: PoolWindowView[];
  notices: BlockedNotice[];
}

export function providerPool(
  accounts: PoolAccount[],
  now: number,
  burn: BurnHours,
  future: FutureUsage,
  strategy: RoutingStrategy,
  mode: ChartMode
): ProviderPoolView {
  const defs = windowDefs(accounts);
  const projection = project(accounts, defs, now, demandFor(accounts, now, burn, future), {
    strategy,
  });
  const burns = new Map(defs.map((def) => [def.id, poolBurnRate(accounts, def.id, now, burn)]));
  const dry =
    mode === 'remaining' && accounts.length > 0
      ? dryAbove({ accounts, defs, now, hours: burn, strategy, current: projection })
      : null;
  const useAll = dry ? fullUseByWindow({ accounts, defs, now, hours: burn }, burns) : null;
  return {
    accounts,
    defs,
    projection,
    windows: defs.map((def) => ({
      def,
      stats: windowStats(accounts, def, projection, burns.get(def.id) ?? 0),
      usual: usualProfile(accounts, def.id, now),
      headroom: dry
        ? {
            useAll: useAll?.get(def.id) ?? { kind: 'nothingDue' },
            dryAbove: dry.get(def.id) ?? { kind: 'never' },
          }
        : null,
    })),
    notices: blockedNotices(accounts, defs, projection),
  };
}

const isLong = (def: WindowDef) => def.windowMs > DAY_MS;

export function chartRange(def: WindowDef, now: number, offset: number): [number, number] {
  const span = isLong(def) ? 14 * DAY_MS : DAY_MS;
  const past = isLong(def) ? 0.22 : 0.5;
  const latest = now + PROJECTION_MS - span;
  const earliest = now - HISTORY_MS;
  const start = Math.max(earliest, Math.min(latest, now - past * span + (offset * span) / 2));
  const aligned = Math.floor(start / STEP_MS) * STEP_MS;
  return [aligned, aligned + span];
}

export interface ChartSeries {
  t0: number;
  t1: number;
  now: number;
  times: number[];
  recordedEnd: number;
  layers: AccountSeries[];
  pool: (number | null)[];
  capacity: (number | null)[];
  blocked: boolean;
  emptyAt: number | null;
  usual: number[] | null;
  events: ChartEvent[];
  ymax: number;
  mode: ChartMode;
}

function niceCeil(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return (
    [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((v) => v >= value) ?? value
  );
}

export function chartSeries(
  pool: ProviderPoolView,
  view: PoolWindowView,
  now: number,
  ui: PoolUi
): ChartSeries {
  const { def } = view;
  const [t0, t1] = chartRange(def, now, ui.offset);
  const step = isLong(def) ? HOUR_MS : STEP_MS;
  const times: number[] = [];
  for (let at = Math.ceil(t0 / step) * step; at <= t1; at += step) times.push(at);
  const poolEmptyAt = view.stats.poolEmptyAt;
  const emptyAt =
    ui.mode === 'remaining' &&
    poolEmptyAt !== null &&
    poolEmptyAt > now &&
    poolEmptyAt >= t0 &&
    poolEmptyAt <= t1
      ? poolEmptyAt
      : null;
  for (const at of [now, emptyAt]) {
    if (at !== null && at > t0 && at < t1 && !times.includes(at)) times.push(at);
  }
  times.sort((a, b) => a - b);
  const recordedEnd = times.filter((at) => at <= now).length - 1;

  const layers: AccountSeries[] = pool.accounts.map((account) => ({
    key: account.key,
    label: account.label,
    points: times.map((at) =>
      at <= now
        ? historyPoint(account, def, pool.defs, at, ui.burn)
        : projectedPoint(pool.projection, account.key, def.id, at)
    ),
  }));

  const valueOf = (layer: AccountSeries, index: number) => {
    const point = layer.points[index];
    if (!point) return null;
    return ui.mode === 'drain' ? point.drain : usableRemaining(point);
  };
  const poolValues = times.map((_, index) => {
    const values = layers.map((layer) => valueOf(layer, index)).filter((v) => v !== null);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  });
  const known = layers.filter((layer) => layer.points.some((point) => point !== null)).length;
  const capacity = times.map((_, index) =>
    poolValues[index] === null
      ? null
      : layers.filter((layer) => {
          const point = layer.points[index];
          return point !== null && !point.blockedBy;
        }).length * 100
  );
  const blocked = layers.some((layer) => layer.points.some((point) => point?.blockedBy));
  const usual = view.usual ? times.map((at) => usualAt(view.usual as number[], at)) : null;
  const peak = Math.max(
    1,
    ...poolValues.map((v) => v ?? 0),
    ...(usual ?? []).map((u) => u * USUAL_BAND)
  );

  return {
    t0,
    t1,
    now,
    times,
    recordedEnd,
    layers,
    pool: poolValues,
    capacity,
    blocked,
    emptyAt,
    usual,
    events: ui.mode === 'remaining' ? chartEvents(times, layers) : [],
    ymax: ui.mode === 'drain' ? niceCeil(peak * 1.1) : Math.max(1, known) * 100,
    mode: ui.mode,
  };
}

export type CreatureKind = 'dragon' | 'tortoise';

export interface CreatureRun {
  kind: CreatureKind;
  from: number;
  to: number;
  peak: number;
}

export function creatureRuns(series: ChartSeries, burn: BurnHours): CreatureRun[] {
  if (!series.usual) return [];
  const runs: CreatureRun[] = [];
  let current = null as CreatureRun | null;
  for (let index = 0; index <= series.recordedEnd; index += 1) {
    const value = series.pool[index] ?? 0;
    const usual = series.usual[index];
    const kind: CreatureKind | null =
      value > 0.3 && value > usual * USUAL_BAND
        ? 'dragon'
        : usual > 0.3 && value > 0 && value < usual / USUAL_BAND
          ? 'tortoise'
          : null;
    if (kind && current?.kind === kind) {
      current.to = index;
      if (value > (series.pool[current.peak] ?? 0)) current.peak = index;
    } else {
      if (current) runs.push(current);
      current = kind ? { kind, from: index, to: index, peak: index } : null;
    }
  }
  if (current) runs.push(current);
  const stepMs = series.times.length > 1 ? series.times[1] - series.times[0] : STEP_MS;
  const minimum = Math.max(1, Math.round((burn * HOUR_MS) / stepMs / 3));
  return runs.filter((run) => run.to - run.from >= minimum);
}
