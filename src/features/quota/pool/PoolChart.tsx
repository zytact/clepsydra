import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DAY_MS, HOUR_MS, RESET_GAIN_PERCENT, USUAL_BAND, type BurnHours } from './model';
import { creatureRuns, type ChartSeries } from './view';
import { useFormatters } from './format';
import styles from './PoolQuota.module.scss';

const PAD = { left: 58, right: 18, top: 30, bottom: 30 };

export interface PoolChartProps {
  series: ChartSeries;
  color: string;
  layerColor: (key: string) => string;
  title: string;
  height: number;
  burn: BurnHours;
  stacked: boolean;
  windowLabel: (id: string) => string;
  staleKeys: ReadonlySet<string>;
}

export function PoolChart({
  series,
  color,
  layerColor,
  title,
  height,
  burn,
  stacked,
  windowLabel,
  staleKeys,
}: PoolChartProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const gradientId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [fromKeyboard, setFromKeyboard] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width))
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;
  const x = (at: number) => PAD.left + ((at - series.t0) / (series.t1 - series.t0)) * innerWidth;
  const y = (value: number) =>
    PAD.top + innerHeight - (Math.min(value, series.ymax) / series.ymax) * innerHeight;
  const drain = series.mode === 'drain';
  const last = series.times.length - 1;
  const recordedEnd = Math.max(0, series.recordedEnd);

  const path = (values: readonly (number | null)[], from: number, to: number) => {
    let d = '';
    let pen = false;
    for (let index = from; index <= to; index += 1) {
      const value = values[index];
      if (value === null || value === undefined) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(series.times[index]).toFixed(1)} ${y(value).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const capacityPath = (values: readonly (number | null)[]) => {
    let d = '';
    let previous: number | null = null;
    values.forEach((value, index) => {
      if (value !== null) {
        const at = x(series.times[index]).toFixed(1);
        d +=
          previous === null
            ? `M${at} ${y(value).toFixed(1)}`
            : `L${at} ${y(previous).toFixed(1)}L${at} ${y(value).toFixed(1)}`;
      }
      previous = value;
    });
    return d;
  };

  const xTicks = useMemo(() => {
    const ticks: { at: number; label: string; line: boolean }[] = [];
    if (series.t1 - series.t0 <= DAY_MS + 1) {
      for (
        let at = Math.ceil(series.t0 / (3 * HOUR_MS)) * 3 * HOUR_MS;
        at <= series.t1;
        at += 3 * HOUR_MS
      ) {
        ticks.push({ at, label: format.hour(at), line: true });
      }
      return ticks;
    }
    const first = new Date(series.t0);
    first.setHours(24, 0, 0, 0);
    const every = innerWidth < 700 ? 2 : 1;
    for (let at = first.getTime(), index = 0; at <= series.t1; at += DAY_MS, index += 1) {
      ticks.push({ at, label: '', line: true });
      if (index % every === 0 && at + DAY_MS / 2 < series.t1) {
        ticks.push({ at: at + DAY_MS / 2, label: format.dayTick(at), line: false });
      }
    }
    return ticks;
  }, [series.t0, series.t1, innerWidth, format]);

  const runs = drain ? creatureRuns(series, burn) : [];
  const placed: number[] =
    series.now >= series.t0 && series.now <= series.t1 ? [x(series.now)] : [];
  const free = (at: number, gap: number) => placed.every((px) => Math.abs(px - at) > gap);

  const annotations: { x: number; y: number; text: string; tone: 'plain' | 'warn' }[] = [];
  if (drain) {
    for (const run of runs) {
      const px = x(series.times[run.peak]);
      if (!free(px, 90)) continue;
      placed.push(px);
      const usual = series.usual?.[run.peak] ?? 0;
      annotations.push({
        x: px,
        y: y(series.pool[run.peak] ?? 0) - 10,
        text:
          run.kind === 'dragon'
            ? t('quota_pool.chart_dragon', {
                multiple: ((series.pool[run.peak] ?? 0) / Math.max(usual, 0.01)).toFixed(1),
              })
            : t('quota_pool.chart_tortoise'),
        tone: 'plain',
      });
    }
  } else {
    for (const event of series.events) {
      const px = x(event.at);
      const important = event.blocked.length > 0 || event.back.length > 0;
      if (!free(px, important ? 60 : 40)) continue;
      placed.push(px);
      const index = series.times.indexOf(event.at);
      const top = Math.max(
        ...series.pool.slice(Math.max(0, index - 1), index + 2).map((value) => value ?? 0)
      );
      const text = [
        event.back.length > 0 ? t('quota_pool.chart_back', { labels: event.back.join(', ') }) : '',
        event.gain >= RESET_GAIN_PERCENT ? `+${format.percent(event.gain)}` : '',
        event.blocked.length > 0
          ? t('quota_pool.chart_blocked', { labels: event.blocked.join(', ') })
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      annotations.push({
        x: px,
        y: Math.max(PAD.top - 8, y(top) - 10),
        text,
        tone: event.blocked.length > 0 ? 'warn' : 'plain',
      });
    }
  }

  const emptyMarker = series.emptyAt === null ? null : { x: x(series.emptyAt), at: series.emptyAt };

  const stackedLayers = useMemo(() => {
    if (!stacked || series.layers.length < 2) return [];
    const cumulative = series.times.map(() => 0);
    return series.layers.map((layer) => {
      const lower = cumulative.slice();
      layer.points.forEach((point, index) => {
        if (!point) return;
        cumulative[index] += drain ? point.drain : point.blockedBy ? 0 : point.remaining;
      });
      return { key: layer.key, lower, upper: cumulative.slice() };
    });
  }, [stacked, series, drain]);

  const band = (from: (u: number) => number) =>
    series.usual?.map(
      (u, index) => `${x(series.times[index]).toFixed(1)} ${y(from(u)).toFixed(1)}`
    ) ?? [];

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    if (px < PAD.left || px > PAD.left + innerWidth) {
      setHover(null);
      return;
    }
    const at = series.t0 + ((px - PAD.left) / innerWidth) * (series.t1 - series.t0);
    let nearest = 0;
    for (let index = 1; index < series.times.length; index += 1) {
      if (Math.abs(series.times[index] - at) < Math.abs(series.times[nearest] - at))
        nearest = index;
    }
    setFromKeyboard(false);
    setHover(nearest);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageDown: -6, PageUp: 6 };
    if (event.key === 'Escape') {
      setHover(null);
      return;
    }
    const delta = steps[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    setFromKeyboard(true);
    setHover((current) => Math.max(0, Math.min(last, (current ?? recordedEnd) + delta)));
  };

  const hoverX = hover === null ? 0 : x(series.times[hover]);
  const tipOnLeft = hover !== null && hoverX + 236 > PAD.left + innerWidth;
  const showNow = series.now >= series.t0 && series.now <= series.t1;
  const nowValue = series.pool[recordedEnd];

  return (
    <div
      ref={containerRef}
      className={styles.chart}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      tabIndex={0}
      role="group"
      aria-label={title}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.24} />
            <stop offset="1" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((fraction) => {
          const value = series.ymax * fraction;
          return (
            <g key={fraction}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerWidth}
                y1={y(value)}
                y2={y(value)}
                className={styles.grid}
              />
              <text x={PAD.left - 14} y={y(value) + 4} textAnchor="end">
                {drain ? format.rate(value) : format.percent(value)}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) =>
          tick.line ? (
            <g key={`l${tick.at}`}>
              <line
                x1={x(tick.at)}
                x2={x(tick.at)}
                y1={PAD.top}
                y2={PAD.top + innerHeight}
                className={styles.gridSoft}
              />
              {tick.label && (
                <text x={x(tick.at)} y={height - 6} textAnchor="middle">
                  {tick.label}
                </text>
              )}
            </g>
          ) : (
            <text key={`t${tick.at}`} x={x(tick.at)} y={height - 6} textAnchor="middle">
              {tick.label}
            </text>
          )
        )}
        {drain && series.usual && (
          <path
            d={`M${band((u) => u * USUAL_BAND).join('L')}L${band((u) => u / USUAL_BAND)
              .reverse()
              .join('L')}Z`}
            className={styles.band}
          />
        )}
        {stackedLayers.length > 0
          ? stackedLayers.flatMap((layer) =>
              (
                [
                  [0, recordedEnd, 0.8],
                  [recordedEnd, last, 0.28],
                ] as const
              ).map(([from, to, opacity]) => {
                if (to <= from) return null;
                let d = '';
                for (let index = from; index <= to; index += 1) {
                  d += `${index === from ? 'M' : 'L'}${x(series.times[index]).toFixed(1)} ${y(layer.upper[index]).toFixed(1)}`;
                }
                for (let index = to; index >= from; index -= 1) {
                  d += `L${x(series.times[index]).toFixed(1)} ${y(layer.lower[index]).toFixed(1)}`;
                }
                return (
                  <path
                    key={`${layer.key}-${from}`}
                    d={`${d}Z`}
                    fill={layerColor(layer.key)}
                    fillOpacity={opacity}
                    className={styles.stackEdge}
                  />
                );
              })
            )
          : (() => {
              const line = path(series.pool, 0, last);
              const firstIndex = series.pool.findIndex((value) => value !== null);
              if (!line || firstIndex === -1) return null;
              return (
                <path
                  d={`${line}L${x(series.times[last]).toFixed(1)} ${y(0)}L${x(series.times[firstIndex]).toFixed(1)} ${y(0)}Z`}
                  fill={`url(#${gradientId})`}
                />
              );
            })()}
        {!drain && series.blocked && (
          <path d={capacityPath(series.capacity)} className={styles.capacity} />
        )}
        <path d={path(series.pool, 0, recordedEnd)} stroke={color} className={styles.recorded} />
        {recordedEnd < last && (
          <path
            d={path(series.pool, recordedEnd, last)}
            stroke={color}
            className={styles.projected}
          />
        )}
        {drain && series.usual && <path d={path(series.usual, 0, last)} className={styles.usual} />}
        {runs.map((run) => (
          <path
            key={`${run.kind}-${run.from}`}
            d={path(series.pool, run.from, run.to)}
            className={run.kind === 'dragon' ? styles.dragon : styles.tortoise}
          />
        ))}
        {annotations.map((annotation) => (
          <text
            key={`${annotation.x}-${annotation.text}`}
            x={annotation.x}
            y={annotation.y}
            textAnchor="middle"
            className={annotation.tone === 'warn' ? styles.annWarn : styles.ann}
          >
            {annotation.text}
          </text>
        ))}
        {emptyMarker && (
          <g>
            <circle cx={emptyMarker.x} cy={y(0)} r={6} className={styles.emptyDot} />
            <text
              x={emptyMarker.x}
              y={y(0) - 14}
              textAnchor={emptyMarker.x > PAD.left + innerWidth - 100 ? 'end' : 'middle'}
              className={styles.annStrong}
            >
              {t('quota_pool.chart_empty', { when: format.when(emptyMarker.at) })}
            </text>
          </g>
        )}
        {showNow && (
          <g>
            <line
              x1={x(series.now)}
              x2={x(series.now)}
              y1={PAD.top - 10}
              y2={PAD.top + innerHeight + 6}
              className={styles.nowLine}
            />
            <text x={x(series.now)} y={PAD.top - 16} textAnchor="middle">
              {t('quota_pool.chart_now')}
            </text>
            {nowValue !== null && nowValue !== undefined && (
              <circle
                cx={x(series.now)}
                cy={y(nowValue)}
                r={4.5}
                fill={color}
                className={styles.nowDot}
              />
            )}
          </g>
        )}
        {hover !== null && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD.top}
              y2={PAD.top + innerHeight}
              className={styles.crosshair}
            />
            {series.pool[hover] !== null && (
              <circle
                cx={hoverX}
                cy={y(series.pool[hover] ?? 0)}
                r={5}
                fill={color}
                className={styles.nowDot}
              />
            )}
          </g>
        )}
      </svg>
      <p className="visually-hidden" aria-live="polite">
        {fromKeyboard && hover !== null && series.pool[hover] !== null
          ? `${format.when(series.times[hover])}: ${
              drain ? format.rate(series.pool[hover] ?? 0) : format.percent(series.pool[hover] ?? 0)
            }`
          : ''}
      </p>
      {hover !== null && (
        <div
          className={styles.tip}
          style={{ left: tipOnLeft ? hoverX - 16 - 220 : hoverX + 16, top: PAD.top }}
        >
          <div>
            <b>{format.when(series.times[hover])}</b>{' '}
            <span className={styles.tag}>
              {series.times[hover] > series.now
                ? t('quota_pool.tip_projected')
                : t('quota_pool.tip_recorded')}
            </span>
          </div>
          {drain ? (
            <>
              <div className={styles.tipRow}>
                <span>{t('quota_pool.tip_drain')}</span>
                <b>{format.rate(series.pool[hover] ?? 0)}</b>
              </div>
              {series.usual && (
                <div className={styles.tipRow}>
                  <span>{t('quota_pool.tip_usual')}</span>
                  <b>{format.rate(series.usual[hover])}</b>
                </div>
              )}
            </>
          ) : (
            <div className={styles.tipRow}>
              <span>{t('quota_pool.tip_pool')}</span>
              <b>
                {series.pool[hover] === null ? '-' : format.percent(series.pool[hover] ?? 0)}{' '}
                <span className={styles.tag}>
                  {t('quota_pool.tip_usable', {
                    capacity: format.percent(series.capacity[hover] ?? 0),
                  })}
                </span>
              </b>
            </div>
          )}
          {series.layers.map((layer) => {
            const point = layer.points[hover];
            const stale = staleKeys.has(layer.key) && series.times[hover] <= series.now;
            return (
              <div key={layer.key} className={styles.tipRow}>
                <span>
                  <i className={styles.swatch} style={{ background: layerColor(layer.key) }} />
                  {layer.label}
                  {stale && <span className={styles.tag}> {t('quota_pool.tip_stale')}</span>}
                </span>
                <span>
                  {!point ? (
                    '-'
                  ) : point.blockedBy ? (
                    <span className={styles.warn}>
                      {t('quota_pool.tip_blocked_by', { window: windowLabel(point.blockedBy) })}
                    </span>
                  ) : drain ? (
                    format.rate(point.drain)
                  ) : (
                    format.percent(point.remaining)
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
