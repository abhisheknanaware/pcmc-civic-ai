import { useTranslation } from 'react-i18next';

const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

// Translates values stored in English by the backend and formats numbers/durations for the active language.
export default function useLabels() {
  const { t, i18n } = useTranslation();
  const locale = LOCALES[i18n.language] || 'en-IN';
  const value = (prefix) => (raw, fallback) => (raw ? t(`${prefix}.${raw}`, { defaultValue: raw }) : (fallback ?? t('na')));

  const splitHours = (ms) => {
    const abs = Math.abs(ms);
    return { h: Math.floor(abs / 3600000), m: Math.floor((abs % 3600000) / 60000) };
  };

  return {
    t,
    locale,
    status: value('status'),
    priority: value('priority'),
    urgency: value('urgency'),
    sentiment: value('sentiment'),
    sla: value('sla'),
    language: value('lang'),
    category: value('cat'),
    department: value('dept'),
    number: (n, options) => (n == null ? '—' : new Intl.NumberFormat(locale, options).format(n)),
    percent: (n) => (n == null ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)}%`),
    duration: (hours) => {
      if (hours == null) return '—';
      const fmt = (v) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v);
      return hours >= 48 ? t('days_short', { value: fmt(hours / 24) }) : t('hours_short', { value: fmt(hours) });
    },
    timeRemaining: (deadline) => {
      if (!deadline) return '';
      const diff = new Date(deadline) - new Date();
      const { h, m } = splitHours(diff);
      // Beyond two days, "5d 10h" reads better than "130h 12m".
      if (h >= 48) return t(diff > 0 ? 'time_left_days' : 'time_overdue_days', { d: Math.floor(h / 24), h: h % 24 });
      return t(diff > 0 ? 'time_left' : 'time_overdue', { h, m });
    },
    timeSince: (date) => {
      const { h, m } = splitHours(new Date() - new Date(date));
      return h >= 48 ? t('time_ago_days', { d: Math.floor(h / 24), h: h % 24 }) : t('time_ago', { h, m });
    },
    date: (d, options = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(locale, options).format(new Date(d)),
  };
}
