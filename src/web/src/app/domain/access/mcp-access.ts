import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';
import { ValueObject } from '../../shared-kernel/value-object';

export const DEPLOYMENT_MODES = ['managed', 'self_hosted'] as const;
export const MCP_SCOPES = ['read', 'evidence:write', 'admin'] as const;
export const API_KEY_STATUSES = ['active', 'revoked'] as const;
export const DOMAIN_STATUSES = ['unverified', 'pending', 'verified'] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
export type McpScope = (typeof MCP_SCOPES)[number];
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export interface McpApiKeySnapshot {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Metadata of a generated key. The full secret is shown once and never stored. */
export class McpApiKey extends Entity<string> {
  private constructor(
    id: string,
    private readonly _name: string,
    private readonly _prefix: string,
    private readonly _scopes: readonly McpScope[],
    private readonly _status: ApiKeyStatus,
    private readonly _createdAt: string,
    private readonly _lastUsedAt: string | null,
  ) {
    super(id);
  }

  static create(props: {
    id: string;
    name: string;
    prefix: string;
    scopes: readonly McpScope[];
    createdAt: string;
  }): McpApiKey {
    const name = props.name.trim();
    if (!name) {
      throw new DomainError('The key needs a name.');
    }
    if (props.scopes.length === 0) {
      throw new DomainError('Choose at least one permission for the key.');
    }
    for (const scope of props.scopes) {
      if (!MCP_SCOPES.includes(scope)) {
        throw new DomainError('Unknown access scope.');
      }
    }
    return new McpApiKey(
      props.id,
      name,
      props.prefix,
      [...props.scopes],
      'active',
      props.createdAt,
      null,
    );
  }

  static restore(snapshot: McpApiKeySnapshot): McpApiKey {
    if (!API_KEY_STATUSES.includes(snapshot.status)) {
      throw new DomainError('Unknown key status.');
    }
    return new McpApiKey(
      snapshot.id,
      snapshot.name,
      snapshot.prefix,
      snapshot.scopes,
      snapshot.status,
      snapshot.createdAt,
      snapshot.lastUsedAt,
    );
  }

  get name(): string {
    return this._name;
  }

  get prefix(): string {
    return this._prefix;
  }

  get scopes(): readonly McpScope[] {
    return this._scopes;
  }

  get status(): ApiKeyStatus {
    return this._status;
  }

  get createdAt(): string {
    return this._createdAt;
  }

  get lastUsedAt(): string | null {
    return this._lastUsedAt;
  }

  get isActive(): boolean {
    return this._status === 'active';
  }

  get masked(): string {
    return `${this._prefix}••••••••`;
  }

  revoke(): McpApiKey {
    if (!this.isActive) {
      throw new DomainError('The key has already been revoked.');
    }
    return new McpApiKey(
      this.id,
      this._name,
      this._prefix,
      this._scopes,
      'revoked',
      this._createdAt,
      this._lastUsedAt,
    );
  }

  toSnapshot(): McpApiKeySnapshot {
    return {
      id: this.id,
      name: this._name,
      prefix: this._prefix,
      scopes: [...this._scopes],
      status: this._status,
      createdAt: this._createdAt,
      lastUsedAt: this._lastUsedAt,
    };
  }
}

export interface DomainVerificationProps {
  token: string;
  status: DomainStatus;
  checkedAt: string | null;
}

/** Ownership proof for a custom trust-center domain. */
export class DomainVerification extends ValueObject<DomainVerificationProps> {
  private constructor(props: DomainVerificationProps) {
    super(props);
  }

  static create(token: string): DomainVerification {
    return new DomainVerification({
      token: requireToken(token),
      status: 'unverified',
      checkedAt: null,
    });
  }

  static restore(props: DomainVerificationProps): DomainVerification {
    if (!DOMAIN_STATUSES.includes(props.status)) {
      throw new DomainError('Unknown domain status.');
    }
    return new DomainVerification({
      token: requireToken(props.token),
      status: props.status,
      checkedAt: props.checkedAt,
    });
  }

  get token(): string {
    return this.props.token;
  }

  get status(): DomainStatus {
    return this.props.status;
  }

  get checkedAt(): string | null {
    return this.props.checkedAt;
  }

  get isVerified(): boolean {
    return this.props.status === 'verified';
  }

  markPending(): DomainVerification {
    return new DomainVerification({
      ...this.props,
      status: 'pending',
      checkedAt: null,
    });
  }

  markVerified(at: string): DomainVerification {
    if (!at.trim()) {
      throw new DomainError('The verification needs a date.');
    }
    return new DomainVerification({
      ...this.props,
      status: 'verified',
      checkedAt: at,
    });
  }

  reset(): DomainVerification {
    return new DomainVerification({
      ...this.props,
      status: 'unverified',
      checkedAt: null,
    });
  }

  toJSON(): DomainVerificationProps {
    return { ...this.props };
  }
}

export interface McpAccessSnapshot {
  organizationId: string;
  deploymentMode: DeploymentMode;
  keys: McpApiKeySnapshot[];
  domain: DomainVerificationProps;
}

/** Access configuration of one organization: deployment mode, keys and domain proof. */
export class McpAccess extends Entity<string> {
  private constructor(
    organizationId: string,
    private readonly _deploymentMode: DeploymentMode,
    private readonly _keys: readonly McpApiKey[],
    private readonly _domain: DomainVerification,
  ) {
    super(organizationId);
  }

  static create(props: {
    organizationId: string;
    deploymentMode: DeploymentMode;
    domainToken: string;
  }): McpAccess {
    return new McpAccess(
      props.organizationId,
      requireMode(props.deploymentMode),
      [],
      DomainVerification.create(props.domainToken),
    );
  }

  static restore(snapshot: McpAccessSnapshot): McpAccess {
    return new McpAccess(
      snapshot.organizationId,
      requireMode(snapshot.deploymentMode),
      snapshot.keys.map((key) => McpApiKey.restore(key)),
      DomainVerification.restore(snapshot.domain),
    );
  }

  get organizationId(): string {
    return this.id;
  }

  get deploymentMode(): DeploymentMode {
    return this._deploymentMode;
  }

  get keys(): readonly McpApiKey[] {
    return this._keys;
  }

  get domain(): DomainVerification {
    return this._domain;
  }

  get activeKeys(): readonly McpApiKey[] {
    return this._keys.filter((key) => key.isActive);
  }

  withDeploymentMode(mode: DeploymentMode): McpAccess {
    return new McpAccess(this.id, requireMode(mode), this._keys, this._domain);
  }

  addKey(key: McpApiKey): McpAccess {
    if (this._keys.some((current) => current.id === key.id)) {
      throw new DomainError('The key already exists.');
    }
    return new McpAccess(this.id, this._deploymentMode, [...this._keys, key], this._domain);
  }

  revokeKey(keyId: string): McpAccess {
    const key = this._keys.find((current) => current.id === keyId);
    if (!key) {
      throw new DomainError('The key was not found.');
    }
    return new McpAccess(
      this.id,
      this._deploymentMode,
      this._keys.map((current) => (current.id === keyId ? current.revoke() : current)),
      this._domain,
    );
  }

  beginDomainCheck(): McpAccess {
    return new McpAccess(this.id, this._deploymentMode, this._keys, this._domain.markPending());
  }

  verifyDomain(at: string): McpAccess {
    return new McpAccess(this.id, this._deploymentMode, this._keys, this._domain.markVerified(at));
  }

  resetDomain(): McpAccess {
    return new McpAccess(this.id, this._deploymentMode, this._keys, this._domain.reset());
  }

  toSnapshot(): McpAccessSnapshot {
    return {
      organizationId: this.id,
      deploymentMode: this._deploymentMode,
      keys: this._keys.map((key) => key.toSnapshot()),
      domain: this._domain.toJSON(),
    };
  }
}

function requireMode(value: DeploymentMode): DeploymentMode {
  if (!DEPLOYMENT_MODES.includes(value)) {
    throw new DomainError('Unknown deployment mode.');
  }
  return value;
}

function requireToken(value: string): string {
  const token = value.trim();
  if (!token) {
    throw new DomainError('The domain verification token is required.');
  }
  return token;
}
