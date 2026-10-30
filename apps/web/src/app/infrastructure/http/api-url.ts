/**
 * Runtime configuration loaded from `config.js` before the application bundle.
 * Deployers set `apiBase` when the UI and the API are served from different
 * origins; the default empty value keeps requests same-origin.
 */
export interface ComplyConfig {
  readonly apiBase?: string;
}

declare global {
  var COMPLY_CONFIG: ComplyConfig | undefined;
}

const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

function isAbsoluteHttpUrl(value: string): boolean {
  return ABSOLUTE_HTTP_URL.test(value);
}

function apiBase(): string {
  return (globalThis.COMPLY_CONFIG?.apiBase ?? '').trim().replace(/\/+$/, '');
}

/**
 * Resolves an API path against the configured base URL. With no base the path
 * is returned as a same-origin relative URL, e.g. `/api/library`.
 */
export function apiUrl(path: string): string {
  const target = path.trim();
  if (isAbsoluteHttpUrl(target)) return target;

  const suffix = target.startsWith('/') ? target : `/${target}`;
  const base = apiBase();
  return base ? `${base}${suffix}` : suffix;
}

/**
 * Absolute variant for browser navigation such as the OIDC start redirect.
 * Without a base it resolves against the current origin, matching the
 * previous `location.assign('/api/...')` behavior.
 */
export function apiAbsoluteUrl(path: string): string {
  const url = apiUrl(path);
  if (isAbsoluteHttpUrl(url)) return url;

  const origin = globalThis.location?.origin;
  return origin && origin !== 'null' ? new URL(url, origin).href : url;
}
