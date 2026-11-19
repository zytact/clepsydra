import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaBucket,
  AntigravityQuotaGroup,
  AntigravityQuotaState,
  AuthFileItem,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
} from '@/types';
import type { RecordedReading } from '@/services/api/quotaHistory';
import { CLAUDE_USAGE_WINDOW_KEYS } from '@/utils/quota';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import type { QuotaProviderType } from '../providers/types';
import type { QuotaCardState } from '../providers';
import {
  resolveAntigravityBucketLabelKey,
  resolveAntigravityGroupLabelKey,
} from '../providers/antigravity/labels';
import {
  DAY_MS,
  HOUR_MS,
  type AccountSample,
  type PoolAccount,
  type WindowReading,
  type WindowScope,
} from './model';

export const CHARTED_PROVIDERS = ['claude', 'codex', 'antigravity', 'kimi'] as const;
export type ChartedProvider = (typeof CHARTED_PROVIDERS)[number];

export const isChartedProvider = (type: QuotaProviderType): type is ChartedProvider =>
  (CHARTED_PROVIDERS as readonly string[]).includes(type);

const ACCOUNT_WIDE: Record<ChartedProvider, readonly string[]> = {
  claude: ['five-hour', 'seven-day'],
  codex: ['five-hour', 'weekly', 'monthly'],
  antigravity: [],
  kimi: [],
};

const DEFAULT_WINDOW_MS: Record<string, number> = {
  'five-hour': 5 * HOUR_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
};

const isTimeWindow = (id: string, periodHours: number | null | undefined) =>
  (typeof periodHours === 'number' && periodHours > 0) ||
  id in DEFAULT_WINDOW_MS ||
  id.startsWith('seven-day');

const CODEX_LABEL_KEYS: Record<string, string> = {
  'five-hour': 'codex_quota.primary_window',
  weekly: 'codex_quota.secondary_window',
  monthly: 'codex_quota.team_secondary_window',
};

const scopeOf = (provider: ChartedProvider, id: string): WindowScope =>
  provider === 'kimi' || ACCOUNT_WIDE[provider].includes(id) ? 'all' : 'model';

const windowMsOf = (
  id: string,
  periodHours: number | null | undefined,
  seconds?: number | null
) => {
  if (typeof seconds === 'number' && seconds > 0) return seconds * 1000;
  if (typeof periodHours === 'number' && periodHours > 0) return periodHours * HOUR_MS;
  return DEFAULT_WINDOW_MS[id] ?? (id.startsWith('seven-day') ? 7 * DAY_MS : 5 * HOUR_MS);
};

const antigravityWindowLabel = (
  group: AntigravityQuotaGroup,
  bucket: AntigravityQuotaBucket,
  t: TFunction
) => {
  const groupKey = resolveAntigravityGroupLabelKey(group.label);
  const bucketKey = resolveAntigravityBucketLabelKey(bucket.label, bucket.window);
  const groupLabel = groupKey ? t(`antigravity_quota.${groupKey}`) : group.label;
  const bucketLabel = bucketKey ? t(`antigravity_quota.${bucketKey}`) : bucket.label;
  return `${groupLabel} · ${bucketLabel}`;
};

export function recordedWindowLabel(provider: ChartedProvider, id: string, t: TFunction): string {
  if (provider === 'claude') {
    const known = CLAUDE_USAGE_WINDOW_KEYS.find((window) => window.id === id);
    if (known) return t(known.labelKey);
  }
  if (provider === 'codex' && CODEX_LABEL_KEYS[id]) return t(CODEX_LABEL_KEYS[id]);
  return id;
}

export function liveWindows(
  provider: ChartedProvider,
  quota: QuotaCardState | undefined,
  t: TFunction
): WindowReading[] {
  if (quota?.status !== 'success') return [];
  if (provider === 'claude' || provider === 'codex') {
    const windows = (quota as unknown as ClaudeQuotaState | CodexQuotaState).windows ?? [];
    return windows.flatMap((window) =>
      typeof window.usedPercent === 'number' && isTimeWindow(window.id, window.periodHours)
        ? [
            {
              id: window.id,
              label: window.label,
              usedPercent: window.usedPercent,
              resetsAt: window.resetAtMs ?? null,
              windowMs: windowMsOf(window.id, window.periodHours),
              scope: scopeOf(provider, window.id),
            },
          ]
        : []
    );
  }
  if (provider === 'antigravity') {
    const groups = (quota as unknown as AntigravityQuotaState).groups ?? [];
    return groups.flatMap((group) =>
      group.buckets.flatMap((bucket) =>
        typeof bucket.remainingFraction === 'number'
          ? [
              {
                id: bucket.id,
                label: antigravityWindowLabel(group, bucket, t),
                usedPercent: (1 - bucket.remainingFraction) * 100,
                resetsAt: bucket.resetAtMs ?? null,
                windowMs: windowMsOf(bucket.id, bucket.periodHours),
                scope: scopeOf(provider, bucket.id),
              },
            ]
          : []
      )
    );
  }
  const rows = (quota as unknown as KimiQuotaState).rows ?? [];
  return rows.flatMap((row) =>
    row.limit > 0
      ? [
          {
            id: row.id,
            label: row.labelKey ? t(row.labelKey, row.labelParams) : (row.label ?? row.id),
            usedPercent: (row.used / row.limit) * 100,
            resetsAt: row.resetAtMs ?? null,
            windowMs: windowMsOf(row.id, row.periodHours),
            scope: scopeOf(provider, row.id),
          },
        ]
      : []
  );
}

export const accountIdentity = (file: AuthFileItem) => file.email?.trim() || file.name;

export function readingsFor(file: AuthFileItem, readings: readonly RecordedReading[]) {
  const authIndex = normalizeRecentRequestAuthIndex(file.authIndex);
  return readings.filter((reading) =>
    authIndex ? reading.authIndex === authIndex : reading.authId === file.name
  );
}

export interface PoolSource {
  file: AuthFileItem;
  label: string;
  quota: QuotaCardState | undefined;
  loadedAt: number | null;
  readings: readonly RecordedReading[];
}

export function poolAccount(
  provider: ChartedProvider,
  source: PoolSource,
  t: TFunction
): PoolAccount {
  const labelOf = (id: string, live: readonly WindowReading[]) =>
    live.find((window) => window.id === id)?.label ?? recordedWindowLabel(provider, id, t);
  const live = liveWindows(provider, source.quota, t);
  const samples: AccountSample[] = source.readings
    .filter((reading) => reading.error === null && reading.windows.length > 0)
    .map((reading) => ({
      at: reading.at,
      windows: reading.windows.map((window) => ({
        id: window.id,
        label: labelOf(window.id, live),
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
        windowMs: windowMsOf(window.id, null, window.windowSeconds),
        scope: window.scope,
      })),
    }));
  if (live.length > 0 && source.loadedAt !== null) {
    samples.push({ at: source.loadedAt, windows: live });
  }
  samples.sort((a, b) => a.at - b.at);
  return {
    key: source.file.name,
    label: source.label,
    priority: source.file.priority ?? 0,
    weight: source.file.weight ?? 1,
    routed: !source.file.quotaOnly,
    samples,
  };
}

export const lastReadingAt = (account: PoolAccount) =>
  account.samples.length > 0 ? account.samples[account.samples.length - 1].at : null;
