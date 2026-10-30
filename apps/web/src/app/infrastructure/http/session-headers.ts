const STORAGE_KEY = 'comply.session';

interface StoredSession {
  readonly session?: string;
  readonly expiresAt?: string;
}

/**
 * Bearer header for authenticated API calls. Returns an empty object when the
 * browser has no valid session, so public endpoints keep working.
 */
export function sessionHeaders(): Record<string, string> {
  const token = sessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function sessionToken(): string {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return '';

    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.session) return '';
    if (stored.expiresAt && Date.parse(stored.expiresAt) < Date.now()) return '';
    return stored.session;
  } catch {
    return '';
  }
}
