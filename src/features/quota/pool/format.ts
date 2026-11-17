import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MINUTE_MS } from './model';

export function formatters(language: string, t: TFunction) {
  const when = new Intl.DateTimeFormat(language, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const hour = new Intl.DateTimeFormat(language, { hour: 'numeric' });
  const dayTick = new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric' });
  const day = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' });
  const countdown = (ms: number) => {
    const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
    if (minutes < 60) return t('quota_pool.duration_minutes', { minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('quota_pool.duration_hours', { hours, minutes: minutes % 60 });
    return t('quota_pool.duration_days', { days: Math.floor(hours / 24), hours: hours % 24 });
  };
  return {
    percent: (value: number) => `${Math.round(value)}%`,
    rate: (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}%/h`,
    when: (at: number) => when.format(at),
    hour: (at: number) => hour.format(at),
    dayTick: (at: number) => dayTick.format(at),
    day: (at: number) => day.format(at),
    countdown,
  };
}

export type Formatters = ReturnType<typeof formatters>;

export function useFormatters(): Formatters {
  const { t, i18n } = useTranslation();
  return useMemo(() => formatters(i18n.language, t), [i18n.language, t]);
}
