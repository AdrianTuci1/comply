import { Injectable, signal } from '@angular/core';
import { SessionResult, SessionUser } from './ports/auth.gateway';

const STORAGE_KEY = 'comply.session';

interface StoredSession {
  session: string;
  expiresAt: string;
  user: SessionUser;
}

function read(): StoredSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.session || !parsed.user?.email) return null;
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Email-link session kept in this browser. The token is an opaque bearer value. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly state = signal<StoredSession | null>(read());

  readonly user = () => this.state()?.user ?? null;
  readonly session = () => this.state()?.session ?? null;
  readonly isSignedIn = () => this.state() !== null;

  save(result: SessionResult): void {
    const stored: StoredSession = {
      session: result.session,
      expiresAt: result.expiresAt,
      user: result.user,
    };
    this.state.set(stored);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Private browsing can reject storage; the in-memory session still works.
    }
  }

  clear(): void {
    this.state.set(null);
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }
}
