import { describe, expect, test } from 'bun:test';
import {
  DAY_MS,
  HOUR_MS,
  poolBurnRate,
  project,
  windowDefs,
  windowStats,
  type PoolAccount,
  type WindowDef,
  type WindowReading,
} from '@/features/quota/pool/model';
import { accountHeadroom } from '@/features/quota/pool/headroom';
import { providerPool } from '@/features/quota/pool/view';

const NOW = Date.UTC(2026, 10, 17, 12, 0);

const fiveHour = (used: number, resetsAt: number | null = NOW + 4 * HOUR_MS): WindowReading => ({
  id: 'five-hour',
  label: '5-hour',
  usedPercent: used,
  resetsAt,
  windowMs: 5 * HOUR_MS,
  scope: 'all',
});

const weekly = (used: number, resetsAt: number | null = NOW + 3 * DAY_MS): WindowReading => ({
  id: 'seven-day',
  label: '7-day',
  usedPercent: used,
  resetsAt,
  windowMs: 7 * DAY_MS,
  scope: 'all',
});

const account = (
  key: string,
  before: WindowReading[],
  after: WindowReading[] = before
): PoolAccount => ({
  key,
  label: key,
  priority: 0,
  routing: { routed: true, weight: 1 },
  samples: [
    { at: NOW - 3 * HOUR_MS, windows: before },
    { at: NOW, windows: after },
  ],
});

const defOf = (accounts: PoolAccount[], id: string): [WindowDef, WindowDef[]] => {
  const defs = windowDefs(accounts);
  const def = defs.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`no ${id} window`);
  return [def, defs];
};

const headroomOf = (entry: PoolAccount, id = 'five-hour', accounts = [entry]) => {
  const [def, defs] = defOf(accounts, id);
  return accountHeadroom({ accounts, def, defs, now: NOW, hours: 3 }, entry);
};

const poolOf = (accounts: PoolAccount[], future: 'same' | 'stop' = 'same') => {
  const view = providerPool(accounts, NOW, 3, future, 'round-robin', 'remaining').windows.find(
    (window) => window.def.id === 'five-hour'
  );
  if (!view?.headroom) throw new Error('no five-hour headroom');
  return view.headroom;
};

describe('account headroom', () => {
  test('needs what is left spread over the time to the reset, against its own burn', () => {
    const room = headroomOf(account('A', [fiveHour(40), weekly(10)], [fiveHour(52), weekly(10.3)]));
    expect(room?.kind).toBe('needs');
    if (room?.kind !== 'needs') return;
    expect(room.needed).toBeCloseTo(11.875, 5);
    expect(room.multiplier).toBeCloseTo(2.96875, 5);
  });

  test('an idle account still needs a rate but has no multiplier', () => {
    expect(headroomOf(account('A', [fiveHour(52)]))).toEqual({
      kind: 'needs',
      needed: 11.875,
      multiplier: null,
    });
  });

  test('has nothing to say for blocked, unstarted, reset or used-up windows', () => {
    expect(headroomOf(account('A', [fiveHour(10), weekly(100)]))).toBeNull();
    expect(headroomOf(account('A', [fiveHour(0, null)]))).toBeNull();
    expect(headroomOf(account('A', [fiveHour(60, NOW - HOUR_MS)]))).toBeNull();
    expect(headroomOf(account('A', [fiveHour(100), weekly(10)]))).toBeNull();
  });

  test('names a longer window that would run out before this one resets', () => {
    const room = headroomOf(account('A', [fiveHour(40), weekly(91)], [fiveHour(52), weekly(93)]));
    expect(room).toEqual({ kind: 'runsOutFirst', window: 'seven-day' });
  });
});

describe('pool headroom', () => {
  test('adds up what every account needs and compares it to the pool burn', () => {
    const accounts = [
      account('A', [fiveHour(40)], [fiveHour(52)]),
      account('B', [fiveHour(60, NOW + 2 * HOUR_MS)], [fiveHour(66, NOW + 2 * HOUR_MS)]),
    ];
    const { useAll } = poolOf(accounts);
    expect(useAll.kind).toBe('pace');
    if (useAll.kind !== 'pace') return;
    expect(useAll.needed).toBeCloseTo(28.625, 5);
    expect(useAll.multiplier).toBeCloseTo(28.625 / 6, 5);
  });

  test('runs dry at the lowest multiple that empties the pool before it refills', () => {
    const { dryAbove } = poolOf([account('A', [fiveHour(20)], [fiveHour(50)])]);
    expect(dryAbove.kind).toBe('at');
    if (dryAbove.kind !== 'at') return;
    expect(dryAbove.multiplier).toBeCloseTo(1.29, 1);
  });

  test('takes the weekly pace when the weekly limit would block a faster one', () => {
    const entry = account('A', [fiveHour(40), weekly(85)], [fiveHour(52), weekly(85.6)]);
    const { useAll, dryAbove } = poolOf([entry]);
    expect(dryAbove.kind).toBe('at');
    if (dryAbove.kind !== 'at') return;
    expect(dryAbove.multiplier).toBeCloseTo(1, 1);
    expect(useAll.kind).toBe('capped');
    if (useAll.kind !== 'capped') return;
    expect(useAll.window).toBe('seven-day');
    expect(useAll.multiplier).toBeCloseTo(13.9 / 72 / 0.2, 5);
    expect(headroomOf(entry)).toEqual({ kind: 'runsOutFirst', window: 'seven-day' });
  });

  test('names the weekly pace when the weekly limit would run out within this cycle', () => {
    const { useAll } = poolOf([
      account('A', [fiveHour(40), weekly(91)], [fiveHour(52), weekly(93)]),
    ]);
    expect(useAll.kind).toBe('capped');
    if (useAll.kind !== 'capped') return;
    expect(useAll.window).toBe('seven-day');
    expect(useAll.multiplier).toBeCloseTo(6.5 / 72 / (2 / 3), 5);
  });

  test('is out of reach when a longer window would run out first and has no pace', () => {
    const { useAll } = poolOf([
      account('A', [fiveHour(40), weekly(91, null)], [fiveHour(52), weekly(93, null)]),
    ]);
    expect(useAll).toEqual({ kind: 'outOfReach', window: 'seven-day' });
  });

  test('neither stat depends on the future usage setting', () => {
    const accounts = [account('A', [fiveHour(40), weekly(91)], [fiveHour(52), weekly(93)])];
    expect(poolOf(accounts, 'stop')).toEqual(poolOf(accounts, 'same'));
    expect(poolOf(accounts, 'stop').dryAbove.kind).toBe('at');
  });

  test('a slow pace with a little quota left still shows a multiplier', () => {
    const { useAll } = poolOf([account('A', [fiveHour(90)], [fiveHour(96)])]);
    expect(useAll.kind).toBe('pace');
    if (useAll.kind !== 'pace') return;
    expect(useAll.multiplier).toBeCloseTo(0.4375, 5);
  });

  test('shows the blocking window when every account with quota left is blocked', () => {
    const { useAll } = poolOf([
      account('A', [fiveHour(10), weekly(100)]),
      account('B', [fiveHour(100), weekly(20)]),
    ]);
    expect(useAll).toEqual({ kind: 'blocked', window: 'seven-day' });
  });

  test('tells used-up pools apart from pools with no reset due', () => {
    expect(poolOf([account('A', [fiveHour(100)])]).useAll).toEqual({ kind: 'allUsed' });
    expect(poolOf([account('A', [fiveHour(0, null)])]).useAll).toEqual({ kind: 'nothingDue' });
  });

  test('an idle account whose longer window would run out caps the pool at the weekly pace', () => {
    const busy = account('A', [fiveHour(70), weekly(40)], [fiveHour(100), weekly(43)]);
    const idle = account('B', [fiveHour(0, NOW + 2 * HOUR_MS), weekly(97)]);
    expect(poolOf([busy, idle]).useAll).toEqual({
      kind: 'capped',
      multiplier: expect.closeTo((56.5 + 2.5) / 72, 5),
      window: 'seven-day',
    });
    expect(headroomOf(idle, 'five-hour', [busy, idle])).toEqual({
      kind: 'runsOutFirst',
      window: 'seven-day',
    });
  });

  test('a window that has not started means nothing is due, not all used', () => {
    const used = account('A', [fiveHour(100)]);
    const fresh = account('B', [fiveHour(0, null)]);
    expect(poolOf([used, fresh]).useAll).toEqual({ kind: 'nothingDue' });
  });

  test('a pool that runs dry at a tiny pace still reports a pace above zero', () => {
    const dry = poolOf([
      account('A', [fiveHour(60, NOW + HOUR_MS)], [fiveHour(99, NOW + HOUR_MS)]),
    ]).dryAbove;
    expect(dry.kind).toBe('at');
    if (dry.kind === 'at') expect(dry.multiplier).toBeGreaterThan(0);
  });

  test('a pool that is empty right now is already dry', () => {
    expect(poolOf([account('A', [fiveHour(100)])]).dryAbove).toEqual({ kind: 'already' });
  });

  test('the shared dry search matches a search per window', () => {
    const modelWindow = (index: number, used: number): WindowReading => ({
      id: `model-${index}`,
      label: `model ${index}`,
      usedPercent: used,
      resetsAt: NOW + (index + 1) * 12 * HOUR_MS,
      windowMs: 7 * DAY_MS,
      scope: 'model',
    });
    const windowsAt = (offset: number, extra: number) => [
      fiveHour(30 + offset * 2),
      weekly(40 + offset),
      ...Array.from({ length: 6 }, (_, index) =>
        modelWindow(index, 10 + index * 8 + offset * (index + 1) * extra)
      ),
    ];
    const accounts = [
      account('A', windowsAt(0, 1), windowsAt(3, 1)),
      account('B', windowsAt(1, 2), windowsAt(4, 2)),
    ];
    const pool = providerPool(accounts, NOW, 3, 'same', 'round-robin', 'remaining');
    const rateAt = (def: WindowDef) => poolBurnRate(accounts, def.id, NOW, 3);
    const emptiesAt = (def: WindowDef, multiplier: number) => {
      const projection = project(accounts, pool.defs, NOW, {
        routed: (other) => rateAt(other) * multiplier,
        own: () => 0,
      });
      return windowStats(accounts, def, projection, 0).poolEmptyAt !== null;
    };
    expect(pool.windows).toHaveLength(8);
    for (const view of pool.windows) {
      const dry = view.headroom?.dryAbove;
      if (!emptiesAt(view.def, 40)) {
        expect(dry).toEqual({ kind: 'never' });
        continue;
      }
      let low = 0;
      let high = 40;
      for (let step = 0; step < 24; step += 1) {
        const middle = (low + high) / 2;
        if (emptiesAt(view.def, middle)) high = middle;
        else low = middle;
      }
      expect(dry?.kind).toBe('at');
      if (dry?.kind !== 'at') continue;
      expect(Math.abs(dry.multiplier - low)).toBeLessThanOrEqual(Math.max(0.05, 0.04 * low) + 0.01);
    }
  });
});
