import { useEffect, useState } from 'react';
import type { AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import { apiClient } from '@/services/api/client';
import { normalizeAuthIndex, parseIsoToMs } from '@/utils/quota';
import type { AuthFileItem } from '@/types';
import {
  readResetGrantsForCard,
  scheduleResetGrantRead,
} from '../providers/claude/resetGrantReads';

export interface ResetGrantSummary {
  left: number;
  expiresAt: number | null;
}

export function summarizeResetGrants(status: AnthropicResetGrantStatus): ResetGrantSummary | null {
  const banked = status.grants.filter((grant) => grant.resetsLeft > 0);
  if (banked.length === 0) return null;
  const ends = banked
    .map((grant) => parseIsoToMs(grant.endsAt))
    .filter((at): at is number => at !== null);
  return {
    left: banked.reduce((sum, grant) => sum + grant.resetsLeft, 0),
    expiresAt: ends.length > 0 ? Math.min(...ends) : null,
  };
}

export function useResetGrantSummary(
  file: AuthFileItem,
  enabled: boolean,
  refreshToken: unknown
): ResetGrantSummary | null {
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const [summary, setSummary] = useState<ResetGrantSummary | null>(null);
  useEffect(() => {
    if (!enabled || !authIndex) return;
    const session = apiClient.getConnectionRevision();
    let cancelled = false;
    const current = () => !cancelled && session === apiClient.getConnectionRevision();
    const cancelRead = scheduleResetGrantRead(() => {
      readResetGrantsForCard(authIndex).then(
        (status) => current() && setSummary(summarizeResetGrants(status)),
        () => current() && setSummary(null)
      );
    }, current);
    return () => {
      cancelled = true;
      cancelRead();
    };
  }, [authIndex, enabled, refreshToken]);
  return enabled ? summary : null;
}
