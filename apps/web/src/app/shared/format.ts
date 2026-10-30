const DAY = 86_400_000;

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateEn(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export function relativeTimeEn(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const days = Math.round(diff / DAY);
  if (Math.abs(days) < 1) {
    const hours = Math.round(diff / 3_600_000);
    if (Math.abs(hours) < 1) return 'a few minutes ago';
    return rtf.format(hours, 'hour');
  }
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  return rtf.format(Math.round(days / 30), 'month');
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const days = Math.round(diff / DAY);
  if (Math.abs(days) < 1) {
    const hours = Math.round(diff / 3_600_000);
    if (Math.abs(hours) < 1) return 'a few minutes ago';
    return rtf.format(hours, 'hour');
  }
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  return rtf.format(Math.round(days / 30), 'month');
}

export function year(iso: string): string {
  return iso.slice(0, 4);
}
