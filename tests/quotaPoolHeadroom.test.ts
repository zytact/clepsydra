import { describe, expect, test } from 'bun:test';
import {
  DAY_MS,
  HOUR_MS,
  windowDefs,
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

const useAllOf = (accounts: PoolAccount[], future: 'same' | 'stop' = 'same') => {
  const view = providerPool(accounts, NOW, 3, future, 'round-robin', 'remaining').windows.find(
    (window) => window.def.id === 'five-hour'
  );
  if (!view?.useAll) throw new Error('no five-hour use it all');
  return view.useAll;
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

describe('pool use it all', () => {
  test('adds up what every account needs and compares it to the pool burn', () => {
    const accounts = [
      account('A', [fiveHour(40)], [fiveHour(52)]),
      account('B', [fiveHour(60, NOW + 2 * HOUR_MS)], [fiveHour(66, NOW + 2 * HOUR_MS)]),
    ];
    const useAll = useAllOf(accounts);
    expect(useAll.kind).toBe('pace');
    if (useAll.kind !== 'pace') return;
    expect(useAll.needed).toBeCloseTo(28.625, 5);
    expect(useAll.multiplier).toBeCloseTo(28.625 / 6, 5);
  });

  test('takes the weekly pace when the weekly limit would block a faster one', () => {
    const entry = account('A', [fiveHour(40), weekly(85)], [fiveHour(52), weekly(85.6)]);
    const useAll = useAllOf([entry]);
    expect(useAll.kind).toBe('capped');
    if (useAll.kind !== 'capped') return;
    expect(useAll.window).toBe('seven-day');
    expect(useAll.multiplier).toBeCloseTo(13.9 / 72 / 0.2, 5);
    expect(headroomOf(entry)).toEqual({ kind: 'runsOutFirst', window: 'seven-day' });
  });

  test('names the weekly pace when the weekly limit would run out within this cycle', () => {
    const useAll = useAllOf([account('A', [fiveHour(40), weekly(91)], [fiveHour(52), weekly(93)])]);
    expect(useAll.kind).toBe('capped');
    if (useAll.kind !== 'capped') return;
    expect(useAll.window).toBe('seven-day');
    expect(useAll.multiplier).toBeCloseTo(6.5 / 72 / (2 / 3), 5);
  });

  test('is out of reach when a longer window would run out first and has no pace', () => {
    const useAll = useAllOf([
      account('A', [fiveHour(40), weekly(91, null)], [fiveHour(52), weekly(93, null)]),
    ]);
    expect(useAll).toEqual({ kind: 'outOfReach', window: 'seven-day' });
  });

  test('does not depend on the future usage setting', () => {
    const accounts = [account('A', [fiveHour(40), weekly(91)], [fiveHour(52), weekly(93)])];
    expect(useAllOf(accounts, 'stop')).toEqual(useAllOf(accounts, 'same'));
  });

  test('a slow pace with a little quota left still shows a multiplier', () => {
    const useAll = useAllOf([account('A', [fiveHour(90)], [fiveHour(96)])]);
    expect(useAll.kind).toBe('pace');
    if (useAll.kind !== 'pace') return;
    expect(useAll.multiplier).toBeCloseTo(0.4375, 5);
  });

  test('shows the blocking window when every account with quota left is blocked', () => {
    const useAll = useAllOf([
      account('A', [fiveHour(10), weekly(100)]),
      account('B', [fiveHour(100), weekly(20)]),
    ]);
    expect(useAll).toEqual({ kind: 'blocked', window: 'seven-day' });
  });

  test('tells used-up pools apart from pools with no reset due', () => {
    expect(useAllOf([account('A', [fiveHour(100)])])).toEqual({ kind: 'allUsed' });
    expect(useAllOf([account('A', [fiveHour(0, null)])])).toEqual({ kind: 'nothingDue' });
  });

  test('an idle account whose longer window would run out caps the pool at the weekly pace', () => {
    const busy = account('A', [fiveHour(70), weekly(40)], [fiveHour(100), weekly(43)]);
    const idle = account('B', [fiveHour(0, NOW + 2 * HOUR_MS), weekly(97)]);
    expect(useAllOf([busy, idle])).toEqual({
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
    expect(useAllOf([used, fresh])).toEqual({ kind: 'nothingDue' });
  });
});
