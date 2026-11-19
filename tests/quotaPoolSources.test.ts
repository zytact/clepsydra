import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { parseQuotaHistory } from '@/services/api/quotaHistory';
import { poolAccount, readingsFor, routingOf } from '@/features/quota/pool/sources';
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

  test('charts every antigravity bucket and lines recorded readings up by bucket id', () => {
    const file = { name: 'antigravity-cli', authIndex: 'idx-ag' } as AuthFileItem;
    const recorded = parseQuotaHistory({
      interval_seconds: 300,
      readings: [
        {
          at: '2026-11-19T15:00:00Z',
          provider: 'antigravity',
          auth_id: 'antigravity-cli',
          auth_index: 'idx-ag',
          windows: [
            { id: 'gemini-5h', used_percent: 1, window_seconds: 18000, scope: 'model' },
            { id: 'gemini-weekly', used_percent: 0.2, window_seconds: 604800, scope: 'model' },
          ],
        },
      ],
    });
    const liveAt = Date.parse('2026-11-19T15:40:00Z');
    const quota = {
      status: 'success',
      groups: [
        {
          id: 'gemini-models',
          label: 'Gemini Models',
          buckets: [
            { id: 'gemini-5h', label: '5h', window: '5h', remainingFraction: 0.98, periodHours: 5 },
            {
              id: 'gemini-weekly',
              label: 'weekly',
              window: 'weekly',
              remainingFraction: 0.995,
              periodHours: 168,
            },
          ],
        },
        {
          id: 'claude-and-gpt-models',
          label: 'Claude and GPT Models',
          buckets: [
            { id: '3p-5h', label: '5h', window: '5h', remainingFraction: 1, periodHours: 5 },
            {
              id: '3p-weekly',
              label: 'weekly',
              window: 'weekly',
              remainingFraction: 1,
              periodHours: 168,
              disabled: true,
            },
          ],
        },
      ],
    } as unknown as QuotaCardState;
    const account = poolAccount(
      'antigravity',
      {
        file,
        label: 'AR',
        quota,
        loadedAt: liveAt,
        readings: readingsFor(file, recorded.readings),
      },
      t
    );
    const [past, now] = account.samples;
    expect(now.windows.map((window) => window.id)).toEqual(['gemini-5h', 'gemini-weekly', '3p-5h']);
    expect(now.windows[1]).toMatchObject({
      label: 'antigravity_quota.group_gemini_models · antigravity_quota.weekly_limit',
      windowMs: 168 * 3600 * 1000,
      scope: { group: 'gemini-' },
    });
    expect(now.windows[0].usedPercent).toBeCloseTo(2);
    expect(past.windows.map((window) => window.label)).toEqual([
      'antigravity_quota.group_gemini_models · antigravity_quota.five_hour_limit',
      'antigravity_quota.group_gemini_models · antigravity_quota.weekly_limit',
    ]);
  });

  test('a quota-only login is not routed before it has any readings', () => {
    const file = {
      name: 'antigravity-cli',
      quotaOnly: true,
      weight: 3,
    } as AuthFileItem;
    expect(routingOf(file)).toEqual({ routed: false });
    const account = poolAccount(
      'antigravity',
      { file, label: 'AR', quota: undefined, loadedAt: null, readings: [] },
      t
    );
    expect(account.samples).toHaveLength(0);
    expect(account.routing).toEqual({ routed: false });
    expect(routingOf({ quotaOnly: false })).toEqual({ routed: true, weight: 1 });
  });
});
