import { Injectable } from '@angular/core';
import {
  AuthGateway,
  AuthProviderList,
  MagicLinkResult,
  RegisterCommand,
  SessionResult,
} from '../../application/ports/auth.gateway';

@Injectable()
export class HttpAuthGateway extends AuthGateway {
  async providers(): Promise<AuthProviderList> {
    return this.get<AuthProviderList>('/api/auth/providers');
  }

  async register(command: RegisterCommand): Promise<SessionResult> {
    return this.post<SessionResult>('/api/auth/register', command);
  }

  async signIn(email: string, password: string): Promise<SessionResult> {
    return this.post<SessionResult>('/api/auth/login', { email, password });
  }

  async exchangeCode(code: string): Promise<SessionResult> {
    return this.post<SessionResult>('/api/auth/exchange', { code });
  }

  async requestLink(email: string): Promise<MagicLinkResult> {
    return this.post<MagicLinkResult>('/api/auth/magic-link', { email });
  }

  async verify(token: string): Promise<SessionResult> {
    return this.post<SessionResult>('/api/auth/verify', { token });
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(path, { headers: { accept: 'application/json' } });
    return this.parse<T>(response);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(response);
  }

  private async parse<T>(response: Response): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? 'Sign-in is unavailable right now.');
    }
    return payload as T;
  }
}
