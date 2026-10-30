import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AuthGateway,
  AuthProvider,
  MagicLinkResult,
  SessionResult,
} from '../../application/ports/auth.gateway';
import { SessionStore } from '../../application/session.store';
import { apiAbsoluteUrl } from '../../infrastructure/http/api-url';
import { Icon } from '../../shared/icon/icon';

@Component({
  selector: 'app-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, DatePipe],
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
})
export class SignIn {
  private readonly auth = inject(AuthGateway);
  private readonly sessions = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly email = signal('');
  readonly password = signal('');
  readonly region = signal('EU');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sent = signal<MagicLinkResult | null>(null);
  readonly verifying = signal(false);
  readonly linkFlow = signal(false);
  readonly linkMode = signal(false);
  readonly codeFlow = signal(false);
  readonly providers = signal<readonly AuthProvider[]>([]);
  readonly demo = signal<{ email: string; password: string } | null>(null);
  readonly setupRequired = signal(false);
  readonly setupName = signal('');
  readonly setupOrganization = signal('');

  constructor() {
    void this.loadProviders();

    const code = this.route.snapshot.queryParamMap.get('code');
    const failure = this.route.snapshot.queryParamMap.get('error');
    const token = this.route.snapshot.queryParamMap.get('token');

    if (token) {
      this.linkFlow.set(true);
      void this.verifyToken(token);
    } else if (code) {
      this.codeFlow.set(true);
      void this.exchangeCode(code);
    } else if (failure) {
      this.error.set(failure);
    }
  }

  setEmail(value: string): void {
    this.email.set(value);
    this.error.set('');
  }

  setPassword(value: string): void {
    this.password.set(value);
    this.error.set('');
  }

  setRegion(value: string): void {
    this.region.set(value);
  }

  setSetupName(value: string): void {
    this.setupName.set(value);
    this.error.set('');
  }

  setSetupOrganization(value: string): void {
    this.setupOrganization.set(value);
    this.error.set('');
  }

  async loadProviders(): Promise<void> {
    try {
      const list = await this.auth.providers();
      this.providers.set(list.providers);
      this.demo.set(list.demo ?? null);
      this.setupRequired.set(list.setupRequired);
    } catch {
      this.providers.set([]);
    }
  }

  usePasswordMode(): void {
    this.linkMode.set(false);
    this.error.set('');
  }

  useLinkMode(): void {
    this.linkMode.set(true);
    this.error.set('');
  }

  useDemo(): void {
    const demo = this.demo();
    if (!demo) return;
    this.email.set(demo.email);
    this.password.set(demo.password);
    this.error.set('');
  }

  async submitPassword(): Promise<void> {
    const email = this.email().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      this.error.set('Enter a valid email address.');
      return;
    }
    if (!this.password()) {
      this.error.set('Enter your password.');
      return;
    }
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set('');
    try {
      await this.finish(await this.auth.signIn(email, this.password()));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Sign-in is unavailable right now.');
    } finally {
      this.busy.set(false);
    }
  }

  async submitSetup(): Promise<void> {
    const email = this.email().trim();
    const name = this.setupName().trim();
    const organizationName = this.setupOrganization().trim();
    if (!name) {
      this.error.set('Enter your full name.');
      return;
    }
    if (!organizationName) {
      this.error.set('Enter your organization name.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      this.error.set('Enter a valid email address.');
      return;
    }
    if (this.password().length < 10) {
      this.error.set('Use a password with at least 10 characters.');
      return;
    }
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set('');
    try {
      await this.finish(
        await this.auth.register({
          email,
          password: this.password(),
          name,
          organizationName,
        }),
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Setup is unavailable right now.');
    } finally {
      this.busy.set(false);
    }
  }

  async submitLink(): Promise<void> {
    const email = this.email().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      this.error.set('Enter a valid email address.');
      return;
    }
    if (this.busy()) return;

    this.busy.set(true);
    this.error.set('');
    try {
      this.sent.set(await this.auth.requestLink(email));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Sign-in is unavailable right now.');
    } finally {
      this.busy.set(false);
    }
  }

  startProvider(provider: AuthProvider): void {
    globalThis.location.assign(apiAbsoluteUrl(`/api/auth/oidc/${provider.id}/start`));
  }

  providerMark(provider: AuthProvider): string {
    return provider.id === 'github' ? 'GH' : provider.label.charAt(0);
  }

  async openDemoLink(): Promise<void> {
    const token = this.sent()?.devToken;
    if (!token || this.verifying()) return;
    this.linkFlow.set(true);
    await this.verifyToken(token);
  }

  async verifyToken(token: string): Promise<void> {
    if (this.verifying()) return;

    this.verifying.set(true);
    this.error.set('');
    try {
      await this.finish(await this.auth.verify(token));
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'This sign-in link is invalid or has expired.',
      );
    } finally {
      this.verifying.set(false);
    }
  }

  async exchangeCode(code: string): Promise<void> {
    if (this.verifying()) return;
    this.verifying.set(true);
    this.error.set('');
    try {
      await this.finish(await this.auth.exchangeCode(code));
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'This sign-in code is invalid or has expired.',
      );
    } finally {
      this.verifying.set(false);
    }
  }

  reset(): void {
    this.sent.set(null);
    this.linkFlow.set(false);
    this.codeFlow.set(false);
    this.error.set('');
  }

  private async finish(result: SessionResult): Promise<void> {
    this.sessions.save(result);
    await this.router.navigateByUrl('/portal/dashboard');
  }
}
