import { describe, expect, test } from 'bun:test';
import {
  HOUR_MS,
  DAY_MS,
  blockedNotices,
  burnRate,
  chartEvents,
  historyPoint,
  project,
  usualProfile,
  windowDefs,
  windowStats,
  type PoolAccount,
  type WindowReading,
} from '@/features/quota/pool/model';

const NOW = Date.UTC(2026, 10, 17, 12, 0);

const fiveHour = (used: number, resetsAt: number | null = NOW + 2 * HOUR_MS): WindowReading => ({
  id: 'five-hour',
  label: '5-hour',
  usedPercent: used,
  resetsAt,
  windowMs: 5 * HOUR_MS,
  scope: 'all',
});

const sevenDay = (used: number, resetsAt: number | null = NOW + 3 * DAY_MS): WindowReading => ({
  id: 'seven-day',
  label: '7-day',
  usedPercent: used,
  resetsAt,
  windowMs: 7 * DAY_MS,
  scope: 'all',
});

const fable = (used: number): WindowReading => ({
  id: 'seven-day-fable',
  label: '7-day Fable',
  usedPercent: used,
  resetsAt: NOW + 4 * DAY_MS,
  windowMs: 7 * DAY_MS,
  scope: 'model',
});

const account = (key: string, samples: PoolAccount['samples']): PoolAccount => ({
  key,
  label: key,
  samples,
});

describe('quota pool model', () => {
  test('orders account-wide windows before model windows, shortest first', () => {
    const defs = windowDefs([
      account('A', [{ at: NOW, windows: [fable(10), sevenDay(5), fiveHour(1)] }]),
    ]);
    expect(defs.map((def) => def.id)).toEqual(['five-hour', 'seven-day', 'seven-day-fable']);
  });

  test('an exhausted 7-day window blocks the shorter and model windows, not itself', () => {
    const a = account('A', [{ at: NOW, windows: [fiveHour(20), sevenDay(100), fable(30)] }]);
    const defs = windowDefs([a]);
    const [five, seven, fab] = defs.map((def) => historyPoint(a, def, defs, NOW, 3));
    expect(five?.blockedBy).toBe('seven-day');
    expect(fab?.blockedBy).toBe('seven-day');
    expect(seven?.blockedBy).toBeNull();
  });

  test('the pool is a plain sum of the accounts that are not blocked', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(20), sevenDay(100)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(40), sevenDay(10)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.current).toBe(60);
    expect(stats.total).toBe(100);
  });

  test('an account without a window stays out of that window pool', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(0), sevenDay(0), fable(30)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(0), sevenDay(0)] }]),
    ];
    const defs = windowDefs(accounts);
    const fableDef = defs.find((def) => def.id === 'seven-day-fable');
    if (!fableDef) throw new Error('no Fable window');
    const projection = project(accounts, defs, NOW, () => 0, HOUR_MS);
    const stats = windowStats(accounts, fableDef, projection, 0);
    expect(stats.current).toBe(70);
    expect(stats.total).toBe(100);
  });

  test('a blocked account comes back when its long window resets', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(20), sevenDay(100, NOW + 6 * HOUR_MS)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0);
    const [notice] = blockedNotices(accounts, defs, projection);
    expect(notice).toEqual({ key: 'A', blockedBy: 'seven-day', until: NOW + 6 * HOUR_MS });
  });

  test('burn rate counts only rises, not resets', () => {
    const a = account('A', [
      { at: NOW - 3 * HOUR_MS, windows: [fiveHour(10)] },
      { at: NOW - 2 * HOUR_MS, windows: [fiveHour(40)] },
      { at: NOW - HOUR_MS, windows: [fiveHour(0)] },
      { at: NOW, windows: [fiveHour(30)] },
    ]);
    expect(burnRate(a, 'five-hour', NOW, 3)).toBe(20);
  });

  test('projection drains the open accounts equally and finds the empty times', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(50, null)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(80, null)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 20, 12 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 20);
    expect(stats.firstEmpty?.key).toBe('B');
    expect(stats.firstEmpty?.at).toBe(NOW + 2 * HOUR_MS);
    expect(stats.poolEmptyAt).toBe(NOW + 3.5 * HOUR_MS);
  });

  test('an account that is already empty is the first empty, now', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(100, null)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(40, null)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0, HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.firstEmpty).toEqual({ key: 'A', at: NOW });
    expect(stats.poolEmptyAt).toBeNull();
  });

  test('routing skips a blocked account, so the others take its share', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(0, null), sevenDay(100, null)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(0, null), sevenDay(0, null)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 10, 2 * HOUR_MS);
    const remainingAt2h = (key: string) =>
      projection.accounts.get(key)?.get('five-hour')?.at(-1)?.remaining;
    expect(remainingAt2h('A')).toBe(100);
    expect(remainingAt2h('B')).toBeCloseTo(80, 5);
  });

  test('a scheduled reset shows as the next reset with its gain', () => {
    const accounts = [account('A', [{ at: NOW, windows: [fiveHour(60, NOW + HOUR_MS)] }])];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0, 4 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.nextReset).toEqual({ at: NOW + HOUR_MS, gain: 60 });
  });

  test('a small reset on a barely used account still shows as the next reset', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(2, NOW + 65 * 60_000)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(0, null)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0, 4 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.nextReset).toEqual({ at: NOW + 65 * 60_000, gain: 2 });
  });

  test('a reset past the projection gains what the projection ends on', () => {
    const accounts = [account('A', [{ at: NOW, windows: [fiveHour(80, NOW + 20 * DAY_MS)] }])];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0, 4 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.nextReset).toEqual({ at: NOW + 20 * DAY_MS, gain: 80 });
  });

  test('a reset past the projection gains nothing while a longer window blocks the account', () => {
    const accounts = [
      account('A', [
        { at: NOW, windows: [fiveHour(80, NOW + 20 * DAY_MS), sevenDay(90, NOW + 3 * DAY_MS)] },
      ]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 20, 4 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.nextReset).toEqual({ at: NOW + 20 * DAY_MS, gain: 0 });
  });

  test('the next reset gain counts only the accounts that reset then', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(50, NOW + 61 * 60_000)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(70, NOW + 66 * 60_000)] }]),
      account('C', [
        { at: NOW, windows: [fiveHour(40, NOW + 61 * 60_000), sevenDay(100, NOW + HOUR_MS)] },
      ]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0, 4 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.nextReset).toEqual({ at: NOW + 61 * 60_000, gain: 50 });
  });

  test('the next reset ignores blocked accounts and needs a reset time', () => {
    const accounts = [
      account('A', [{ at: NOW, windows: [fiveHour(50, NOW + HOUR_MS), sevenDay(100, null)] }]),
      account('B', [{ at: NOW, windows: [fiveHour(0, null), sevenDay(0, null)] }]),
    ];
    const defs = windowDefs(accounts);
    const projection = project(accounts, defs, NOW, () => 0, 4 * HOUR_MS);
    const stats = windowStats(accounts, defs[0], projection, 0);
    expect(stats.nextReset).toBeNull();
  });

  test('the usual pattern needs a day of history', () => {
    const young = [
      account('A', [
        { at: NOW - HOUR_MS, windows: [fiveHour(0)] },
        { at: NOW, windows: [fiveHour(10)] },
      ]),
    ];
    expect(usualProfile(young, 'five-hour', NOW)).toBeNull();
    const learned = [
      account('A', [
        { at: NOW - 2 * DAY_MS, windows: [fiveHour(0)] },
        { at: NOW - 2 * DAY_MS + HOUR_MS, windows: [fiveHour(20)] },
        { at: NOW, windows: [fiveHour(20)] },
      ]),
    ];
    const profile = usualProfile(learned, 'five-hour', NOW);
    expect(profile?.reduce((sum, value) => sum + value, 0)).toBeCloseTo(10, 5);
  });

  test('chart events name accounts that become blocked and come back', () => {
    const times = [NOW, NOW + HOUR_MS, NOW + 2 * HOUR_MS];
    const events = chartEvents(times, [
      {
        key: 'A',
        label: 'TA',
        points: [
          { remaining: 50, blockedBy: null, drain: 0 },
          { remaining: 50, blockedBy: 'seven-day', drain: 0 },
          { remaining: 90, blockedBy: null, drain: 0 },
        ],
      },
    ]);
    expect(events).toEqual([
      { at: NOW + HOUR_MS, gain: 0, blocked: ['TA'], back: [] },
      { at: NOW + 2 * HOUR_MS, gain: 90, blocked: [], back: ['TA'] },
    ]);
  });
});
