import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { QuotaCard } from '../components/QuotaCard';
import type { QuotaCardState } from '../providers';
import type { QuotaFileEntry } from '../logic';
import { burnRate, historyPoint, readingAt, type BurnHours, type PoolAccount } from './model';
import type { ProviderPoolView } from './view';
import type { Formatters } from './format';
import { lastReadingAt } from './sources';
import styles from './PoolQuota.module.scss';

export interface AccountRow {
  entry: QuotaFileEntry;
  label: string;
  identity: string;
  color: string;
  quota: QuotaCardState | undefined;
  account: PoolAccount | null;
  stale: boolean;
}

export interface AccountsTableProps {
  rows: AccountRow[];
  pool: ProviderPoolView;
  now: number;
  burn: BurnHours;
  showEmails: boolean;
  format: Formatters;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resettingName: string | null;
  windowLabel: (id: string) => string;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
}

function planOf(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  t: TFunction
): string | null {
  if (quota?.status !== 'success') return null;
  const state = quota as QuotaCardState & {
    planType?: string | null;
    planName?: string | null;
    subscription?: { plan?: string | null; tierName?: string | null } | null;
  };
  if (entry.type === 'claude' && state.planType) {
    return t(`claude_quota.${state.planType}`, { defaultValue: state.planType });
  }
  if (entry.type === 'codex' && state.planType) {
    const plan = state.planType.trim().toLowerCase();
    return t(`codex_quota.plan_${plan}`, { defaultValue: state.planType });
  }
  if (entry.type === 'antigravity' && state.subscription?.plan) {
    const plan = state.subscription.plan.replace('-', '_');
    return t(`antigravity_subscription.plan_${plan}`, {
      defaultValue: state.subscription.tierName ?? state.subscription.plan,
    });
  }
  return state.planName ?? state.planType ?? null;
}

export function AccountsTable({
  rows,
  pool,
  now,
  burn,
  showEmails,
  format,
  resolvedTheme,
  canRefresh,
  resettingName,
  windowLabel,
  onRefresh,
  onReset,
}: AccountsTableProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const notices = new Map(pool.notices.map((notice) => [notice.key, notice]));
  const columns = 6 + pool.defs.length;

  const toggle = (key: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className={styles.tableWrap}>
      <table className={styles.accounts}>
        <thead>
          <tr>
            <th>{t('quota_pool.col_account')}</th>
            <th>{t('quota_pool.col_plan')}</th>
            <th>{t('quota_pool.col_weight')}</th>
            {pool.defs.map((def) => (
              <th key={def.id}>{def.label}</th>
            ))}
            <th>{t('quota_pool.col_status')}</th>
            <th>
              <span className="visually-hidden">{t('quota_pool.col_actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { entry, account } = row;
            const key = entry.file.name;
            const disabled = Boolean(entry.file.disabled);
            const notice = notices.get(key);
            const loading = row.quota?.status === 'loading';
            const error =
              row.quota?.status === 'error'
                ? resolveQuotaErrorMessage(t, row.quota.errorStatus, row.quota.error ?? '')
                : null;
            const lastAt = account ? lastReadingAt(account) : null;
            const status = disabled
              ? { tone: 'dim', text: t('quota_pool.status_disabled') }
              : error
                ? { tone: 'error', text: t('quota_pool.status_error') }
                : notice
                  ? {
                      tone: 'warn',
                      text: notice.until
                        ? t('quota_pool.status_blocked', { when: format.when(notice.until) })
                        : t('quota_pool.status_blocked_unknown'),
                    }
                  : lastAt
                    ? {
                        tone: row.stale ? 'warn' : 'dim',
                        text: t('quota_pool.status_updated', {
                          ago: format.countdown(now - lastAt),
                        }),
                      }
                    : { tone: 'dim', text: t('quota_pool.status_no_reading') };
            const expanded = open.has(key);
            return (
              <Fragment key={key}>
                <tr data-disabled={disabled || undefined}>
                  <td>
                    <div className={styles.who}>
                      <span
                        className={styles.chip}
                        style={{ boxShadow: `inset 3px 0 0 ${row.color}` }}
                      >
                        {row.label}
                      </span>
                      <span className={showEmails ? styles.email : styles.emailHidden}>
                        {row.identity}
                      </span>
                    </div>
                  </td>
                  <td>{planOf(entry, row.quota, t) ?? '-'}</td>
                  <td>{entry.file.weight ?? 1}</td>
                  {pool.defs.map((def) => {
                    const point = account ? historyPoint(account, def, pool.defs, now, burn) : null;
                    if (!account || !point) {
                      return (
                        <td key={def.id} className={styles.dim}>
                          -
                        </td>
                      );
                    }
                    if (point.blockedBy) {
                      return (
                        <td key={def.id} className={styles.blockedCell}>
                          <b>{t('quota_pool.cell_blocked')}</b>
                          <small>
                            {t('quota_pool.cell_blocked_detail', {
                              window: windowLabel(point.blockedBy),
                              percent: format.percent(point.remaining),
                            })}
                          </small>
                        </td>
                      );
                    }
                    const reading = readingAt(account, def.id, now);
                    const resetsAt = reading?.resetsAt ?? null;
                    return (
                      <td key={def.id} className={styles.windowCell}>
                        <b>{format.percent(point.remaining)}</b>{' '}
                        <span className={styles.dim}>
                          {format.rate(burnRate(account, def.id, now, burn))}
                        </span>
                        <small>
                          {resetsAt !== null
                            ? t('quota_pool.cell_resets_in', {
                                countdown: format.countdown(resetsAt - now),
                              })
                            : point.remaining >= 100
                              ? t('quota_pool.cell_not_started')
                              : t('quota_pool.cell_no_reset')}
                        </small>
                      </td>
                    );
                  })}
                  <td className={styles[`status_${status.tone}`]}>{status.text}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={!canRefresh || disabled || loading}
                        onClick={() => onRefresh(entry)}
                      >
                        <RefreshCw
                          size={14}
                          aria-hidden="true"
                          className={loading ? styles.spin : undefined}
                        />
                        {t('quota_pool.action_refresh')}
                      </button>
                      <button
                        type="button"
                        className={styles.smallButton}
                        aria-expanded={expanded}
                        onClick={() => toggle(key)}
                      >
                        <ChevronDown
                          size={14}
                          aria-hidden="true"
                          className={expanded ? styles.flip : undefined}
                        />
                        {expanded
                          ? t('quota_pool.action_hide_details')
                          : t('quota_pool.action_details')}
                      </button>
                    </div>
                  </td>
                </tr>
                {error && !expanded && (
                  <tr className={styles.errorLine}>
                    <td colSpan={columns}>
                      <div className={styles.errorBox}>{error}</div>
                    </td>
                  </tr>
                )}
                {expanded && (
                  <tr className={styles.detailLine}>
                    <td colSpan={columns}>
                      <div className={styles.details}>
                        <QuotaCard
                          entry={entry}
                          quota={row.quota}
                          resolvedTheme={resolvedTheme}
                          canRefresh={canRefresh && !disabled}
                          resetting={resettingName === key}
                          onRefresh={() => onRefresh(entry)}
                          onReset={() => onReset(entry)}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
