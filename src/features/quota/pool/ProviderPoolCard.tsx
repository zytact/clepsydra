import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import type { QuotaFileEntry } from '../logic';
import { PROJECTION_MS, DAY_MS } from './model';
import { chartSeries, type PoolUi, type ProviderPoolView } from './view';
import { PoolChart } from './PoolChart';
import { AccountsTable, type AccountRow } from './AccountsTable';
import type { Formatters } from './format';
import { isChartedProvider } from './sources';
import styles from './PoolQuota.module.scss';

export interface ProviderPoolCardProps {
  provider: QuotaProviderType;
  rows: AccountRow[];
  pool: ProviderPoolView;
  now: number;
  ui: PoolUi;
  showEmails: boolean;
  format: Formatters;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resettingName: string | null;
  charted: boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
}

const providerColor = (provider: QuotaProviderType) =>
  isChartedProvider(provider) ? `var(--provider-${provider})` : 'var(--provider-other)';

export function ProviderPoolCard(props: ProviderPoolCardProps) {
  const { provider, rows, pool, now, ui, showEmails, format, resolvedTheme, charted } = props;
  const { t } = useTranslation();
  const icon = getAuthFileIcon(provider, resolvedTheme);
  const color = providerColor(provider);
  const labelOf = useMemo(
    () => new Map(rows.map((row) => [row.entry.file.name, row.label])),
    [rows]
  );
  const colorOf = useMemo(
    () => new Map(rows.map((row) => [row.entry.file.name, row.color])),
    [rows]
  );
  const staleKeys = useMemo(
    () => new Set(rows.filter((row) => row.stale).map((row) => row.entry.file.name)),
    [rows]
  );
  const windowLabel = (id: string) => pool.defs.find((def) => def.id === id)?.label ?? id;
  const liveCount = rows.filter((row) => !row.entry.file.disabled).length;

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        {icon && <img src={icon} alt="" className={styles.providerIcon} />}
        <h2>{getTypeLabel(t, provider)}</h2>
        <span className={styles.sub}>{t('quota_pool.accounts_count', { count: liveCount })}</span>
      </div>

      {pool.notices.map((notice) => (
        <div key={notice.key} className={styles.notice} role="note">
          <Lock size={16} aria-hidden="true" />
          {notice.until
            ? t('quota_pool.blocked_notice', {
                label: labelOf.get(notice.key) ?? notice.key,
                window: windowLabel(notice.blockedBy).toLowerCase(),
                until: format.when(notice.until),
                countdown: format.countdown(notice.until - now),
              })
            : t('quota_pool.blocked_notice_unknown', {
                label: labelOf.get(notice.key) ?? notice.key,
                window: windowLabel(notice.blockedBy).toLowerCase(),
              })}
        </div>
      ))}

      {!charted && <p className={styles.hint}>{t('quota_pool.no_windows')}</p>}

      {pool.windows.map((view) => {
        const { def, stats } = view;
        const series = chartSeries(pool, view, now, ui);
        const hero =
          ui.mode === 'drain' ? (
            <>
              {format.rate(stats.burn)}
              <small>{t('quota_pool.hero_drain', { hours: ui.burn })}</small>
            </>
          ) : (
            <>
              {format.percent(stats.current)}
              <small>{t('quota_pool.hero_of', { total: format.percent(stats.total) })}</small>
            </>
          );
        const firstLabel = stats.firstEmpty
          ? (labelOf.get(stats.firstEmpty.key) ?? stats.firstEmpty.key)
          : '';
        const first = !stats.firstEmpty
          ? stats.poolEmptyAt !== null && stats.poolEmptyAt <= now
            ? t('quota_pool.empty_now')
            : t('quota_pool.not_in_days', { days: PROJECTION_MS / DAY_MS })
          : stats.firstEmpty.at <= now
            ? t('quota_pool.first_empty_now', { label: firstLabel })
            : t('quota_pool.first_empty_value', {
                label: firstLabel,
                countdown: format.countdown(stats.firstEmpty.at - now),
              });
        const poolEmpty =
          stats.poolEmptyAt === null
            ? t('quota_pool.not_by', { date: format.day(now + PROJECTION_MS) })
            : stats.poolEmptyAt <= now
              ? t('quota_pool.empty_now')
              : format.when(stats.poolEmptyAt);
        const items: [string, React.ReactNode][] = [
          [t('quota_pool.stat_pool_empty'), poolEmpty],
          [t('quota_pool.stat_first_empty'), first],
          [
            t('quota_pool.stat_next_reset'),
            stats.nextReset ? (
              <>
                +{format.percent(stats.nextReset.gain)}{' '}
                <span className={styles.dim}>{format.when(stats.nextReset.at)}</span>
              </>
            ) : (
              t('quota_pool.none_scheduled')
            ),
          ],
          [t('quota_pool.stat_burn', { hours: ui.burn }), format.rate(stats.burn)],
        ];
        const modeLabel =
          ui.mode === 'drain' ? t('quota_pool.mode_drain') : t('quota_pool.mode_remaining');
        return (
          <section key={def.id} className={styles.window} aria-label={def.label}>
            <div className={styles.windowHead}>
              <div>
                <div className={styles.windowName}>{def.label}</div>
                <div className={styles.hero}>{hero}</div>
              </div>
              <span className={styles.grow} />
              <dl className={styles.stats}>
                {items.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <PoolChart
              series={series}
              color={color}
              layerColor={(key) => colorOf.get(key) ?? 'var(--text-quaternary)'}
              title={`${getTypeLabel(t, provider)} ${def.label} ${modeLabel}`}
              height={def.windowMs > DAY_MS ? 320 : 280}
              burn={ui.burn}
              stacked={ui.stacked}
              windowLabel={windowLabel}
              staleKeys={staleKeys}
            />
            <Legend
              color={color}
              ui={ui}
              accounts={
                ui.stacked && pool.accounts.length > 1 ? pool.accounts.map((a) => a.key) : []
              }
              labelOf={(key) => labelOf.get(key) ?? key}
              colorOf={(key) => colorOf.get(key) ?? 'var(--text-quaternary)'}
              capacity={ui.mode === 'remaining' && series.blocked}
              usual={ui.mode === 'drain' && view.usual !== null}
            />
            {(ui.mode === 'drain' || ui.future === 'usual') && view.usual === null && (
              <p className={styles.hint}>{t('quota_pool.learning')}</p>
            )}
          </section>
        );
      })}

      <AccountsTable
        rows={rows}
        pool={pool}
        now={now}
        burn={ui.burn}
        showEmails={showEmails}
        format={format}
        resolvedTheme={resolvedTheme}
        canRefresh={props.canRefresh}
        resettingName={props.resettingName}
        windowLabel={windowLabel}
        onRefresh={props.onRefresh}
        onReset={props.onReset}
      />
    </article>
  );
}

interface LegendProps {
  color: string;
  ui: PoolUi;
  accounts: string[];
  labelOf: (key: string) => string;
  colorOf: (key: string) => string;
  capacity: boolean;
  usual: boolean;
}

function Legend({ color, ui, accounts, labelOf, colorOf, capacity, usual }: LegendProps) {
  const { t } = useTranslation();
  const line = (dash?: string, stroke = color, width = 2) => (
    <svg width="24" height="8" aria-hidden="true">
      <line
        x1="0"
        x2="24"
        y1="4"
        y2="4"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash}
      />
    </svg>
  );
  return (
    <div className={styles.legend}>
      <span className={styles.legendLead}>{t('quota_pool.legend_pool')}</span>
      {accounts.map((key) => (
        <span key={key} className={styles.legendItem}>
          <i className={styles.swatch} style={{ background: colorOf(key) }} />
          {labelOf(key)}
        </span>
      ))}
      <span className={styles.legendItem}>
        {line()}
        {t('quota_pool.legend_recorded')}
      </span>
      <span className={styles.legendItem}>
        {line('5 4')}
        {t('quota_pool.legend_projected')}
      </span>
      {capacity && (
        <span className={styles.legendItem}>
          {line('2 4', 'var(--text-quaternary)', 1.25)}
          {t('quota_pool.legend_capacity')}
        </span>
      )}
      {ui.mode === 'drain' && usual && (
        <>
          <span className={styles.legendItem}>
            <svg width="18" height="12" aria-hidden="true">
              <rect width="18" height="12" rx="3" fill="var(--chart-band)" />
            </svg>
            {t('quota_pool.legend_usual')}
          </span>
          <span className={styles.legendItem}>
            {line(undefined, 'var(--quota-medium-color)', 3.5)}
            {t('quota_pool.legend_dragon')}
          </span>
          <span className={styles.legendItem}>
            {line(undefined, 'var(--good-color)', 3.5)}
            {t('quota_pool.legend_tortoise')}
          </span>
        </>
      )}
    </div>
  );
}
