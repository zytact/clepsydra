import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type RecordedScope = 'all' | 'model';

export interface RecordedWindow {
  id: string;
  usedPercent: number;
  resetsAt: number | null;
  windowSeconds: number | null;
  scope: RecordedScope;
}

export interface RecordedReading {
  at: number;
  provider: string;
  authId: string;
  authIndex: string;
  windows: RecordedWindow[];
  error: string | null;
}

export interface QuotaHistory {
  intervalSeconds: number;
  readings: RecordedReading[];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const instant = (value: unknown) => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

function parseWindow(value: unknown): RecordedWindow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.used_percent !== 'number') {
    return null;
  }
  return {
    id: value.id,
    usedPercent: value.used_percent,
    resetsAt: instant(value.resets_at),
    windowSeconds: typeof value.window_seconds === 'number' ? value.window_seconds : null,
    scope: value.scope === 'model' ? 'model' : 'all',
  };
}

function parseReading(value: unknown): RecordedReading | null {
  if (!isRecord(value)) return null;
  const at = instant(value.at);
  if (at === null) return null;
  const windows = Array.isArray(value.windows) ? value.windows : [];
  return {
    at,
    provider: text(value.provider),
    authId: text(value.auth_id),
    authIndex: text(value.auth_index),
    windows: windows.map(parseWindow).filter((window) => window !== null),
    error: text(value.error) || null,
  };
}

export function parseQuotaHistory(value: unknown): QuotaHistory {
  if (!isRecord(value)) return { intervalSeconds: 300, readings: [] };
  const readings = Array.isArray(value.readings) ? value.readings : [];
  return {
    intervalSeconds: typeof value.interval_seconds === 'number' ? value.interval_seconds : 300,
    readings: readings.map(parseReading).filter((reading) => reading !== null),
  };
}

const isNotFound = (error: unknown) => isRecord(error) && error.status === 404;

export const quotaHistoryApi = {
  async fetch(since: Date): Promise<QuotaHistory | null> {
    try {
      const value = await apiClient.get<unknown>('/quota/history', {
        params: { since: since.toISOString().replace(/\.\d{3}Z$/, 'Z') },
      });
      return parseQuotaHistory(value);
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },
};
