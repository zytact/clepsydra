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
  weight: 1,
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

const headroomOf = (entry: PoolAccount, id = 'five-hour') => {
  const [def, defs] = defOf([entry], id);
  return accountHeadroom(entry, def, defs, NOW, 3);
};

const poolOf = (accounts: PoolAccount[], future: 'same' | 'stop' = 'same') => {
  const view = providerPool(accounts, NOW, 3, future, 'round-robin').windows.find(
    (window) => window.def.id === 'five-hour'
  );
  if (!view) throw new Error('no five-hour window');
  return view.headroom;
};

describe('account headroom', () => {
  test('needs what is left spread over the time to the reset, against its own burn', () => {
    const room = headroomOf(account('A', [fiveHour(40), weekly(10)], [fiveHour(52), weekly(10.3)]));
    expect(room?.kind).toBe('needs');
    if (room?.kind !== 'needs') return;
    expect(room.needed).toBeCloseTo(12, 5);
    expect(room.multiplier).toBeCloseTo(3, 5);
  });

  test('an idle account still needs a rate but has no multiplier', () => {
    expect(headroomOf(account('A', [fiveHour(52)]))).toEqual({
      kind: 'needs',
      needed: 12,
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
    const { useAll, dryAbove } = poolOf(accounts, 'stop');
    expect(dryAbove).toEqual({ kind: 'never' });
    expect(useAll.kind).toBe('pace');
    if (useAll.kind !== 'pace') return;
    expect(useAll.needed).toBeCloseTo(29, 5);
    expect(useAll.multiplier).toBeCloseTo(29 / 6, 5);
  });

  test('runs dry at the lowest multiple that empties the pool before it refills', () => {
    const { dryAbove } = poolOf([account('A', [fiveHour(20)], [fiveHour(50)])]);
    expect(dryAbove.kind).toBe('at');
    if (dryAbove.kind !== 'at') return;
    expect(dryAbove.multiplier).toBeCloseTo(1.29, 1);
    expect(dryAbove.window).toBe('five-hour');
  });

  test('stays reachable when a longer window only runs dry after this cycle', () => {
    const { useAll, dryAbove } = poolOf([
      account('A', [fiveHour(40), weekly(85)], [fiveHour(52), weekly(85.6)]),
    ]);
    expect(dryAbove.kind).toBe('at');
    if (dryAbove.kind !== 'at') return;
    expect(dryAbove.window).toBe('seven-day');
    expect(dryAbove.multiplier).toBeCloseTo(1, 1);
    expect(useAll.kind).toBe('pace');
    if (useAll.kind !== 'pace') return;
    expect(useAll.multiplier).toBeCloseTo(3, 5);
  });

  test('is out of reach when a longer window runs out within this cycle', () => {
    const { useAll } = poolOf([
      account('A', [fiveHour(50), weekly(92)], [fiveHour(53), weekly(92.3)]),
      account('B', [fiveHour(0), weekly(10)], [fiveHour(9), weekly(13)]),
    ]);
    expect(useAll.kind).toBe('outOfReach');
    if (useAll.kind !== 'outOfReach') return;
    expect(useAll.window).toBe('seven-day');
  });

  test('tells used-up pools apart from pools with no reset due', () => {
    expect(poolOf([account('A', [fiveHour(100)])]).useAll).toEqual({ kind: 'allUsed' });
    expect(poolOf([account('A', [fiveHour(0, null)])]).useAll).toEqual({ kind: 'nothingDue' });
  });

  test('a pool that is empty right now is already dry', () => {
    expect(poolOf([account('A', [fiveHour(100)])]).dryAbove).toEqual({ kind: 'already' });
  });
});
