import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { parseQuotaHistory } from '@/services/api/quotaHistory';
import { poolAccount, readingsFor } from '@/features/quota/pool/sources';
import type { QuotaCardState } from '@/features/quota/providers';
import type { AuthFileItem } from '@/types';

const t = ((key: string) => key) as unknown as TFunction;

const history = parseQuotaHistory({
  interval_seconds: 300,
  readings: [
    {
      at: '2026-11-17T10:00:00Z',
      provider: 'claude',
      auth_id: 'claude-a.json',
      auth_index: 'idx-a',
      windows: [
        {
          id: 'five-hour',
          used_percent: 10,
          resets_at: '2026-11-17T12:00:00Z',
          window_seconds: 18000,
          scope: 'all',
        },
        {
          id: 'seven-day-fable',
          used_percent: 5,
          resets_at: null,
          window_seconds: 604800,
          scope: 'model',
        },
        { id: 'broken' },
      ],
    },
    {
      at: '2026-11-17T10:05:00Z',
      provider: 'claude',
      auth_id: 'claude-a.json',
      auth_index: 'idx-a',
      error: 'usage request returned status 429',
    },
    { at: 'not a time', provider: 'claude', auth_id: 'claude-a.json', auth_index: 'idx-a' },
    {
      at: '2026-11-17T10:00:00Z',
      provider: 'claude',
      auth_id: 'claude-b.json',
      auth_index: 'idx-b',
      windows: [],
    },
  ],
});

describe('quota pool sources', () => {
  test('parses readings and drops what it cannot read', () => {
    expect(history.readings).toHaveLength(3);
    expect(history.readings[0].windows.map((window) => window.id)).toEqual([
      'five-hour',
      'seven-day-fable',
    ]);
    expect(history.readings[0].windows[1].scope).toBe('model');
    expect(history.readings[1].error).toBe('usage request returned status 429');
  });

  test('matches readings to a file by auth index, else by file name', () => {
    const byIndex = { name: 'renamed.json', authIndex: 'idx-a' } as AuthFileItem;
    const byName = { name: 'claude-b.json' } as AuthFileItem;
    expect(readingsFor(byIndex, history.readings)).toHaveLength(2);
    expect(readingsFor(byName, history.readings).map((reading) => reading.authId)).toEqual([
      'claude-b.json',
    ]);
  });

  test('merges recorded readings with the live reading, skipping failed polls', () => {
    const file = { name: 'claude-a.json', authIndex: 'idx-a' } as AuthFileItem;
    const liveAt = Date.parse('2026-11-17T10:10:00Z');
    const quota = {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 30,
          resetLabel: '',
          resetAtMs: null,
          periodHours: 5,
        },
      ],
    } as unknown as QuotaCardState;
    const account = poolAccount(
      'claude',
      { file, label: 'AR', quota, loadedAt: liveAt, readings: readingsFor(file, history.readings) },
      t
    );
    expect(account.samples.map((sample) => sample.at)).toEqual([
      Date.parse('2026-11-17T10:00:00Z'),
      liveAt,
    ]);
    expect(account.samples[0].windows[0].label).toBe('5-hour limit');
    expect(account.samples[1].windows[0]).toMatchObject({ usedPercent: 30, scope: 'all' });
  });
});
