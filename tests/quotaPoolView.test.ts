import { describe, expect, test } from 'bun:test';
import { HOUR_MS, DAY_MS, type PoolAccount, type WindowReading } from '@/features/quota/pool/model';
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
  const pool = providerPool(accounts, NOW, 3, 'same');
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

  test('the pool empty time is a chart sample where the line reaches empty', () => {
    const pool = providerPool([account('A', 90, 10)], NOW, 3, 'same');
    const view = pool.windows.find((window) => window.def.id === 'seven-day');
    if (!view) throw new Error('no seven-day window');
    const emptyAt = NOW + 7 * HOUR_MS + 10 * 60 * 1000;
    const series = chartSeries(
      pool,
      { ...view, stats: { ...view.stats, poolEmptyAt: emptyAt } },
      NOW,
      ui
    );
    expect(series.emptyAt).toBe(emptyAt);
    expect(series.times).toContain(emptyAt);
    const paged = chartSeries(
      pool,
      { ...view, stats: { ...view.stats, poolEmptyAt: emptyAt } },
      NOW,
      {
        ...ui,
        offset: -2,
      }
    );
    expect(paged.emptyAt).toBeNull();
  });
});
