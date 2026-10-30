export type SessionRole = 'admin' | 'member';

export interface SessionUser {
  email: string;
  name: string;
  organizationName: string;
  role?: SessionRole;
}

export interface MagicLinkResult {
  sent: true;
  email: string;
  expiresAt: string;
  /** Present outside production so the demo can open the link without an inbox. */
  devToken?: string;
}

export interface SessionResult {
  session: string;
  expiresAt: string;
  user: SessionUser;
}

export interface AuthProvider {
  id: string;
  label: string;
  kind: 'oidc' | 'oauth2';
}

export interface AuthProviderList {
  password: boolean;
  providers: AuthProvider[];
  demo?: { email: string; password: string } | null;
  setupRequired: boolean;
}

export interface RegisterCommand {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}

/** Port: password, email-link, and OIDC sign-in. */
export abstract class AuthGateway {
  abstract providers(): Promise<AuthProviderList>;
  abstract register(command: RegisterCommand): Promise<SessionResult>;
  abstract signIn(email: string, password: string): Promise<SessionResult>;
  abstract exchangeCode(code: string): Promise<SessionResult>;
  abstract requestLink(email: string): Promise<MagicLinkResult>;
  abstract verify(token: string): Promise<SessionResult>;
}
