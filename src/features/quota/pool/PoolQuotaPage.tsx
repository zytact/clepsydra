import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';
import { authFilesApi } from '@/services/api';
import { quotaHistoryApi, type QuotaHistory } from '@/services/api/quotaHistory';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { classifyQuotaFiles, type QuotaFileEntry } from '../logic';
import { QUOTA_TAB_ORDER } from '../constants';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType, QuotaStore } from '../providers/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { useQuotaActions } from '../hooks/useQuotaActions';
import { useQuotaBatchLoader } from '../hooks/useQuotaBatchLoader';
import { accountLabels } from './labels';
import { BURN_HOURS, DAY_MS, MINUTE_MS, type BurnHours, type FutureUsage } from './model';
import {
  accountIdentity,
  isChartedProvider,
  lastReadingAt,
  poolAccount,
  readingsFor,
  type ChartedProvider,
} from './sources';
import { HISTORY_MS, OFFSET_LIMITS, chartRange, providerPool, type PoolUi } from './view';
import { ProviderPoolCard } from './ProviderPoolCard';
import type { AccountRow } from './AccountsTable';
import { useFormatters } from './format';
import styles from './PoolQuota.module.scss';

const STALE_MS = 30 * MINUTE_MS;
const FRESH_MS = 10 * MINUTE_MS;
const SERIES_COLORS = 6;

type Tab = 'all' | QuotaProviderType;

const quotaKey = (entry: QuotaFileEntry) => getQuotaCacheKey(entry.file);

const firstSeen = new WeakMap<QuotaCardState, number>();

function readingTime(quota: QuotaCardState): number {
  const observed = Date.parse(
    (quota as QuotaCardState & { observedAt?: string | null }).observedAt ?? ''
  );
  if (Number.isFinite(observed)) return observed;
  const seen = firstSeen.get(quota);
  if (seen !== undefined) return seen;
  const at = Date.now();
  firstSeen.set(quota, at);
  return at;
}

export function PoolQuotaPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const disableControls = connectionStatus !== 'connected';
  const clock = useNow();

  const [files, setFiles] = useState<AuthFileItem[] | null>(null);
  const [history, setHistory] = useState<QuotaHistory | null>(null);
  const [historySupported, setHistorySupported] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [showEmails, setShowEmails] = useState(false);
  const [ui, setUi] = useState<PoolUi>({
    mode: 'remaining',
    burn: 6,
    future: 'same',
    stacked: false,
    offset: 0,
  });

  const { loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);

  const quotaState = useQuotaStore();
  const quotaOf = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      QUOTA_ADAPTERS[entry.type].storeSelector(quotaState as unknown as QuotaStore)[
        quotaKey(entry)
      ],
    [quotaState]
  );

  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    if (connectionStatus !== 'connected') return null;
    setRefreshing(true);
    setError('');
    try {
      const [list, recorded] = await Promise.all([
        authFilesApi.list(),
        quotaHistoryApi
          .fetch(new Date(Date.now() - HISTORY_MS))
          .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
      ]);
      if (request !== requestRef.current) return null;
      const nextFiles = list?.files ?? [];
      setFiles(nextFiles);
      if (recorded instanceof Error) {
        setHistoryError(recorded.message);
        return { files: nextFiles, history: null };
      }
      setHistoryError('');
      setHistory(recorded);
      setHistorySupported(recorded !== null);
      return { files: nextFiles, history: recorded };
    } catch (err: unknown) {
      if (request === requestRef.current) {
        setError(err instanceof Error ? err.message : t('notification.refresh_failed'));
      }
      return null;
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, [connectionStatus, t]);

  const entries = useMemo(() => classifyQuotaFiles(files ?? []), [files]);

  const loadStale = useCallback(
    (loaded: { files: AuthFileItem[]; history: QuotaHistory | null }, everything: boolean) => {
      const fresh = Date.now() - FRESH_MS;
      const targets = classifyQuotaFiles(loaded.files).filter((entry) => {
        if (entry.file.disabled) return false;
        if (everything) return true;
        const recent = readingsFor(entry.file, loaded.history?.readings ?? []).some(
          (reading) => reading.error === null && reading.at >= fresh
        );
        return !recent && !quotaOf(entry);
      });
      if (targets.length > 0) void loadQuota(targets);
    },
    [loadQuota, quotaOf]
  );

  const initialLoad = useRef(false);
  useEffect(() => {
    if (initialLoad.current || connectionStatus !== 'connected') return;
    initialLoad.current = true;
    void load().then((loaded) => loaded && loadStale(loaded, false));
  }, [connectionStatus, load, loadStale]);

  const refreshAll = useCallback(() => {
    if (disableControls) return;
    void load().then((loaded) => loaded && loadStale(loaded, true));
  }, [disableControls, load, loadStale]);
  useHeaderRefresh(refreshAll);

  const loadedAtByKey = useMemo(() => {
    const times = new Map<string, number>();
    for (const entry of entries) {
      const quota = quotaOf(entry);
      if (quota?.status === 'success') times.set(quotaKey(entry), readingTime(quota));
    }
    return times;
  }, [entries, quotaOf]);

  const now = useMemo(() => Math.max(clock, ...loadedAtByKey.values()), [clock, loadedAtByKey]);

  const labels = useMemo(
    () => accountLabels(entries.map((entry) => accountIdentity(entry.file))),
    [entries]
  );

  const providers = useMemo(
    () => QUOTA_TAB_ORDER.filter((type) => entries.some((entry) => entry.type === type)),
    [entries]
  );

  const cards = useMemo(() => {
    const readings = history?.readings ?? [];
    return providers.map((provider) => {
      const own = entries.filter((entry) => entry.type === provider);
      const live = own.filter((entry) => !entry.file.disabled);
      const charted = isChartedProvider(provider);
      const accounts = charted
        ? live.map((entry) => {
            const quota = quotaOf(entry);
            return poolAccount(
              provider as ChartedProvider,
              {
                file: entry.file,
                label: labels.get(accountIdentity(entry.file)) ?? '?',
                quota,
                loadedAt:
                  quota?.status === 'success' ? (loadedAtByKey.get(quotaKey(entry)) ?? null) : null,
                readings: readingsFor(entry.file, readings),
              },
              t
            );
          })
        : [];
      const withData = accounts.filter((account) => account.samples.length > 0);
      const pool = providerPool(withData, now, ui.burn, ui.future);
      const rows: AccountRow[] = [...live, ...own.filter((entry) => entry.file.disabled)].map(
        (entry) => {
          const account = withData.find((candidate) => candidate.key === entry.file.name) ?? null;
          const lastAt = account ? lastReadingAt(account) : null;
          const index = live.indexOf(entry);
          return {
            entry,
            label: labels.get(accountIdentity(entry.file)) ?? '?',
            identity: accountIdentity(entry.file),
            color:
              index === -1
                ? 'var(--text-quaternary)'
                : `var(--series-${(index % SERIES_COLORS) + 1})`,
            quota: quotaOf(entry),
            account,
            stale: lastAt !== null && now - lastAt > STALE_MS,
          };
        }
      );
      return { provider, rows, pool, charted };
    });
  }, [providers, entries, history, quotaOf, labels, loadedAtByKey, now, ui.burn, ui.future, t]);

  const visibleCards = cards.filter((card) => tab === 'all' || card.provider === tab);
  const loadedCount = entries.filter((entry) => quotaOf(entry)?.status === 'success').length;
  const canRefresh = !disableControls && !refreshing;
  const rangeWindow = cards.flatMap((card) => card.pool.defs).find((def) => def.windowMs > DAY_MS);
  const [rangeStart, rangeEnd] = rangeWindow ? chartRange(rangeWindow, now, ui.offset) : [now, now];

  const set = <K extends keyof PoolUi>(key: K, value: PoolUi[K]) =>
    setUi((previous) => ({ ...previous, [key]: value }));
  const shift = (delta: number) =>
    set(
      'offset',
      delta === 0 ? 0 : Math.max(OFFSET_LIMITS.min, Math.min(OFFSET_LIMITS.max, ui.offset + delta))
    );

  const segmented = <V extends string | number>(
    name: string,
    options: [V, string][],
    current: V,
    onPick: (value: V) => void
  ) =>
    options.map(([value, label]) => (
      <button
        key={String(value)}
        type="button"
        aria-pressed={current === value}
        data-control={name}
        onClick={() => onPick(value)}
      >
        {label}
      </button>
    ));

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h1>{t('quota_pool.title')}</h1>
        <span className={styles.meta}>
          {t('quota_pool.meta', { total: entries.length, loaded: loadedCount })}
        </span>
        <span className={styles.grow} />
        <button
          type="button"
          className={styles.button}
          onClick={() => setShowEmails((value) => !value)}
        >
          {showEmails ? (
            <EyeOff size={16} aria-hidden="true" />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )}
          {showEmails ? t('quota_pool.hide_emails') : t('quota_pool.show_emails')}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={!canRefresh}
          onClick={refreshAll}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={refreshing ? styles.spin : undefined}
          />
          {t('quota_pool.refresh_all')}
        </button>
      </div>

      <div className={styles.tabs} role="group" aria-label={t('quota_pool.providers_label')}>
        {(['all', ...providers] as Tab[]).map((id) => {
          const icon = id === 'all' ? null : getAuthFileIcon(id, resolvedTheme);
          const count =
            id === 'all' ? entries.length : entries.filter((entry) => entry.type === id).length;
          return (
            <button
              key={id}
              type="button"
              className={styles.tab}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {id === 'all' ? (
                <Command size={16} aria-hidden="true" />
              ) : (
                icon && <img src={icon} alt="" />
              )}
              {id === 'all' ? t('quota_pool.tab_all') : getTypeLabel(t, id)}
              <span className={styles.count}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.controls}>
        <div className={styles.group}>
          {segmented(
            'mode',
            [
              ['remaining', t('quota_pool.mode_remaining')],
              ['drain', t('quota_pool.mode_drain')],
            ],
            ui.mode,
            (value) => set('mode', value)
          )}
        </div>
        <div className={styles.group}>
          <span>{t('quota_pool.burn_label')}</span>
          {segmented<BurnHours>(
            'burn',
            BURN_HOURS.map((hours): [BurnHours, string] => [
              hours,
              t('quota_pool.hours_short', { hours }),
            ]),
            ui.burn,
            (value) => set('burn', value)
          )}
        </div>
        <div className={styles.group}>
          <span id="pool-future-label">{t('quota_pool.future_label')}</span>
          <label className={styles.select}>
            <select
              aria-labelledby="pool-future-label"
              value={ui.future}
              onChange={(event) => set('future', event.target.value as FutureUsage)}
            >
              <option value="same">{t('quota_pool.future_same')}</option>
              <option value="usual">{t('quota_pool.future_usual')}</option>
              <option value="stop">{t('quota_pool.future_stop')}</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        </div>
        <div className={styles.group}>
          <button
            type="button"
            aria-pressed={ui.stacked}
            onClick={() => set('stacked', !ui.stacked)}
          >
            {t('quota_pool.accounts_toggle')}
          </button>
        </div>
        <div className={styles.navigator}>
          {rangeWindow && (
            <span className={styles.range}>
              {t('quota_pool.range', { from: format.day(rangeStart), to: format.day(rangeEnd) })}
            </span>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('quota_pool.earlier')}
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div className={styles.group}>
            <button type="button" aria-pressed={ui.offset === 0} onClick={() => shift(0)}>
              {t('quota_pool.today')}
            </button>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('quota_pool.later')}
            onClick={() => shift(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!historySupported && <p className={styles.hint}>{t('quota_pool.no_history')}</p>}
      {historyError && (
        <p className={styles.hint} role="status">
          {t('quota_pool.history_failed', { message: historyError })}
        </p>
      )}
      {error && (
        <div className={styles.errorBox} role="alert">
          {error}
        </div>
      )}

      {files === null ? (
        <Skeleton height={420} rounded={18} />
      ) : visibleCards.length === 0 ? (
        <EmptyState title={t('quota_pool.empty_title')} description={t('quota_pool.empty_desc')} />
      ) : (
        visibleCards.map((card) => (
          <ProviderPoolCard
            key={card.provider}
            provider={card.provider}
            rows={card.rows}
            pool={card.pool}
            charted={card.charted}
            now={now}
            ui={ui}
            showEmails={showEmails}
            format={format}
            resolvedTheme={resolvedTheme}
            canRefresh={canRefresh}
            resettingName={resettingQuotaName}
            onRefresh={(entry) => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
            onReset={(entry) => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
          />
        ))
      )}
    </div>
  );
}
