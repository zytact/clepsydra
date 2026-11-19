import { describe, expect, test } from 'bun:test';
import type {
  AnthropicResetGrant,
  AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import { summarizeResetGrants } from '@/features/quota/pool/resetGrants';

const grant = (overrides: Partial<AnthropicResetGrant>): AnthropicResetGrant => ({
  id: 'g',
  label: 'Reset',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: null,
  clears: [],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});

const status = (grants: AnthropicResetGrant[]): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: false,
  grants,
  nextGrantId: null,
  weeklyResetsAt: null,
  cooldownUntil: null,
});

describe('summarizeResetGrants', () => {
  test('counts banked resets and takes the soonest expiry among them', () => {
    expect(
      summarizeResetGrants(
        status([
          grant({ id: 'a', resetsLeft: 2, endsAt: '2026-12-11T00:00:00Z' }),
          grant({ id: 'b', resetsLeft: 1, endsAt: '2026-12-01T00:00:00Z' }),
          grant({ id: 'c', resetsLeft: 0, endsAt: '2026-11-20T00:00:00Z' }),
        ])
      )
    ).toEqual({ left: 3, expiresAt: Date.parse('2026-12-01T00:00:00Z') });
  });

  test('returns nothing when every grant is spent', () => {
    expect(summarizeResetGrants(status([grant({ resetsLeft: 0 })]))).toBeNull();
  });

  test('keeps the count when no grant states an expiry', () => {
    expect(summarizeResetGrants(status([grant({})]))).toEqual({ left: 1, expiresAt: null });
  });
});
