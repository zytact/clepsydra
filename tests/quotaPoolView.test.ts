import { describe, expect, test } from 'bun:test';
import {
  HOUR_MS,
  DAY_MS,
  projectedPoint,
  type PoolAccount,
  type WindowReading,
} from '@/features/quota/pool/model';
import { chartSeries, providerPool, type PoolUi } from '@/features/quota/pool/view';

const NOW = Date.UTC(2026, 10, 17, 12, 0);

const reading = (id: string, windowMs: number, used: number): WindowReading => ({
  id,
  label: id,
  usedPercent: used,
  resetsAt: NOW + windowMs / 2,
  windowMs,
  scope: 'all',
});

const account = (key: string, fiveHour: number, sevenDay: number): PoolAccount => ({
  key,
  label: key,
  priority: 0,
  routing: { routed: true, weight: 1 },
  samples: [
    {
      at: NOW,
      windows: [
        reading('five-hour', 5 * HOUR_MS, fiveHour),
        reading('seven-day', 7 * DAY_MS, sevenDay),
      ],
    },
  ],
});

const ui: PoolUi = { mode: 'remaining', burn: 3, future: 'same', stacked: false, offset: 0 };

function fiveHourSeries(accounts: PoolAccount[]) {
  const pool = providerPool(accounts, NOW, 3, 'same', 'round-robin', 'remaining');
  const view = pool.windows.find((window) => window.def.id === 'five-hour');
  if (!view) throw new Error('no five-hour window');
  return chartSeries(pool, view, NOW, ui);
}

describe('quota pool chart series', () => {
  test('usable capacity drops by the accounts a longer window blocks', () => {
    const series = fiveHourSeries([account('A', 20, 100), account('B', 40, 10)]);
    expect(series.blocked).toBe(true);
    expect(series.capacity[series.recordedEnd]).toBe(100);
    expect(series.ymax).toBe(200);
  });

  test('nothing blocked means no usable capacity line', () => {
    const series = fiveHourSeries([account('A', 20, 30), account('B', 40, 10)]);
    expect(series.blocked).toBe(false);
    expect(series.capacity[series.recordedEnd]).toBe(200);
  });

  test('the pool empty time becomes a chart sample', () => {
    const pool = providerPool([account('A', 90, 10)], NOW, 3, 'same', 'round-robin', 'remaining');
    const view = pool.windows.find((window) => window.def.id === 'seven-day');
    if (!view) throw new Error('no seven-day window');
    const emptyAt = NOW + 7 * HOUR_MS + 10 * 60 * 1000;
    const emptying = {
      ...view,
      stats: { ...view.stats, poolEmptyAt: emptyAt, firstEmpty: null },
    };
    const series = chartSeries(pool, emptying, NOW, ui);
    expect(series.emptyAt).toBe(emptyAt);
    expect(series.times).toContain(emptyAt);
    const paged = chartSeries(pool, emptying, NOW, {
      ...ui,
      offset: -2,
    });
    expect(paged.emptyAt).toBeNull();
  });

  describe('quota-only accounts', () => {
    const burning = (
      key: string,
      routed: boolean,
      from: number,
      to: number,
      resetsAt: number | null = null
    ): PoolAccount => {
      const fiveHourAt = (used: number): WindowReading => ({
        ...reading('five-hour', 5 * HOUR_MS, used),
        resetsAt,
      });
      return {
        key,
        label: key,
        priority: 0,
        routing: routed ? { routed: true, weight: 1 } : { routed: false },
        samples: [
          { at: NOW - 3 * HOUR_MS, windows: [fiveHourAt(from)] },
          { at: NOW, windows: [fiveHourAt(to)] },
        ],
      };
    };
    const fiveHourView = (accounts: PoolAccount[]) => {
      const pool = providerPool(accounts, NOW, 3, 'same', 'round-robin', 'remaining');
      const view = pool.windows.find((window) => window.def.id === 'five-hour');
      if (!view) throw new Error('no five-hour window');
      return { pool, view };
    };
    const remainingAfter = (pool: ReturnType<typeof providerPool>, key: string, hours: number) =>
      projectedPoint(pool.projection, key, 'five-hour', NOW + hours * HOUR_MS)?.remaining;

    test('their burn does not drain the routed accounts', () => {
      const { pool } = fiveHourView([burning('ROUTED', true, 0, 0), burning('CLI', false, 0, 30)]);
      expect(remainingAfter(pool, 'ROUTED', 1)).toBe(100);
    });

    test('they drain at their own recent burn rate', () => {
      const { pool } = fiveHourView([burning('ROUTED', true, 0, 0), burning('CLI', false, 0, 30)]);
      expect(remainingAfter(pool, 'CLI', 1)).toBeCloseTo(60, 5);
    });

    test('alone, they compute empty times and use it all from their own burn', () => {
      const resetsAt = NOW + 4 * HOUR_MS;
      const { pool, view } = fiveHourView([burning('CLI', false, 30, 75, resetsAt)]);
      expect(view.stats.current).toBe(25);
      expect(view.stats.burn).toBeCloseTo(15, 5);
      expect(view.stats.firstEmpty?.key).toBe('CLI');
      expect(view.stats.poolEmptyAt).toBeGreaterThan(NOW);
      expect(view.stats.poolEmptyAt).toBeLessThan(resetsAt);
      expect(view.useAll.kind).toBe('pace');
      expect(remainingAfter(pool, 'CLI', 1)).toBeCloseTo(10, 5);
      const series = chartSeries(pool, view, NOW, ui);
      expect(series.layers.map((layer) => layer.key)).toEqual(['CLI']);
    });

    test('alone and idle, they still report the needed pace', () => {
      const resetsAt = NOW + 4 * HOUR_MS;
      const { view } = fiveHourView([burning('CLI', false, 5, 5, resetsAt)]);
      expect(view.stats.burn).toBe(0);
      expect(view.stats.poolEmptyAt).toBeNull();
      expect(view.stats.firstEmpty).toBeNull();
      expect(view.useAll).toEqual({
        kind: 'pace',
        needed: (95 - 0.5) / 4,
        multiplier: null,
      });
    });

    test('pool empty waits for every account, including quota-only accounts', () => {
      const { view } = fiveHourView([
        burning('ROUTED', true, 50, 99.6),
        burning('CLI', false, 0, 0),
      ]);
      expect(view.stats.firstEmpty).toEqual({ key: 'ROUTED', at: NOW });
      expect(view.stats.poolEmptyAt).toBeNull();
      expect(view.stats.current).toBeCloseTo(100.4, 5);
    });

    test('a window present only on a quota-only account still reports use it all', () => {
      const routed = burning('ROUTED', true, 0, 30, NOW + 4 * HOUR_MS);
      const cli: PoolAccount = {
        key: 'CLI',
        label: 'CLI',
        priority: 0,
        routing: { routed: false },
        samples: [
          {
            at: NOW,
            windows: [
              reading('five-hour', 5 * HOUR_MS, 10),
              reading('gemini-argon-wtu-weekly', 7 * DAY_MS, 20),
            ],
          },
        ],
      };
      const pool = providerPool([routed, cli], NOW, 3, 'same', 'round-robin', 'remaining');
      const shared = pool.windows.find((window) => window.def.id === 'five-hour');
      const cliOnly = pool.windows.find((window) => window.def.id === 'gemini-argon-wtu-weekly');
      expect(shared?.useAll).not.toBeNull();
      expect(cliOnly?.useAll).not.toBeNull();
      expect(cliOnly?.useAll.kind).toBe('pace');
    });
  });
});
