import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { McpAccessFacade } from '../../../application/mcp-access.facade';
import { McpKeyGateway, McpKeyView } from '../../../application/ports/mcp-key.gateway';
import { OrganizationStore } from '../../../application/organization.store';
import { DeploymentMode, MCP_SCOPES, McpScope } from '../../../domain/access/mcp-access';
import { formatDate } from '../../../shared/format';
import { Icon } from '../../../shared/icon/icon';
import {
  DEPLOYMENT_MODE_LABELS,
  DOMAIN_STATUS_LABELS,
  MCP_SCOPE_LABELS,
  PLAN_LABELS,
} from '../../../shared/i18n/labels';
import { PageHeader } from '../../../shared/page-header/page-header';
import { StatusBadge } from '../../../shared/status-badge/status-badge';

interface SettingsForm {
  name: string;
  cui: string;
  contactName: string;
  contactEmail: string;
  retentionDays: number;
  sealedMode: boolean;
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, StatusBadge, Icon, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly organizations = inject(OrganizationStore);
  private readonly mcpAccess = inject(McpAccessFacade);
  private readonly keyGateway = inject(McpKeyGateway);

  readonly organization = this.organizations.active;
  readonly keys = signal<readonly McpKeyView[]>([]);
  readonly keysLoading = signal(true);
  readonly planLabels = PLAN_LABELS;
  readonly saved = signal(false);

  readonly deploymentLabels = DEPLOYMENT_MODE_LABELS;
  readonly domainLabels = DOMAIN_STATUS_LABELS;
  readonly scopeLabels = MCP_SCOPE_LABELS;
  readonly formatDate = formatDate;
  readonly scopes = MCP_SCOPES.map((key) => ({ key, label: MCP_SCOPE_LABELS[key] }));

  readonly mcp = computed(() => this.mcpAccess.accessFor(this.organizations.activeId()));
  readonly endpoint = computed(() => {
    const organization = this.organization();
    return this.mcp()?.deploymentMode === 'self_hosted'
      ? `https://${organization.trustCenter.domain}/mcp`
      : `https://mcp.comply.ro/${organization.slug}/mcp`;
  });
  readonly activeKeyCount = computed(() => this.keys().filter((key) => this.isActive(key)).length);
  readonly domainStatus = computed(() => this.mcp()?.domain.status ?? 'unverified');

  readonly keyOpen = signal(false);
  readonly keyName = signal('');
  readonly keyScopes = signal<readonly McpScope[]>(['read']);
  readonly keyError = signal('');
  readonly newSecret = signal('');
  readonly newKeyName = signal('');
  readonly copied = signal('');
  readonly mcpError = signal('');

  readonly form = linkedSignal<SettingsForm>(() => {
    const organization = this.organizations.active();
    return {
      name: organization.name,
      cui: organization.cui,
      contactName: organization.contact.name,
      contactEmail: organization.contact.email,
      retentionDays: organization.retentionDays,
      sealedMode: organization.sealedMode,
    };
  });

  constructor() {
    void this.loadKeys();
  }

  readonly dirty = computed(() => {
    const organization = this.organization();
    const form = this.form();
    return (
      organization.name !== form.name ||
      organization.cui !== form.cui ||
      organization.contact.name !== form.contactName ||
      organization.contact.email !== form.contactEmail ||
      organization.retentionDays !== form.retentionDays ||
      organization.sealedMode !== form.sealedMode
    );
  });

  patch<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]): void {
    this.form.update((form) => ({ ...form, [key]: value }));
    this.saved.set(false);
  }

  save(): void {
    this.organizations.updateProfile(this.form());
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2500);
  }

  setDeploymentMode(value: string): void {
    const mode: DeploymentMode = value === 'self_hosted' ? 'self_hosted' : 'managed';
    const result = this.mcpAccess.setDeploymentMode(this.organizations.activeId(), mode);
    this.mcpError.set(result.isFailure ? result.error! : '');
  }

  openKeyForm(): void {
    this.keyOpen.set(true);
    this.keyName.set('');
    this.keyScopes.set(['read']);
    this.keyError.set('');
  }

  toggleScope(scope: McpScope, checked: boolean): void {
    this.keyScopes.update((scopes) =>
      checked
        ? [...scopes.filter((item) => item !== scope), scope]
        : scopes.filter((item) => item !== scope),
    );
    this.keyError.set('');
  }

  async loadKeys(): Promise<void> {
    this.keysLoading.set(true);
    try {
      this.keys.set(await this.keyGateway.list(this.organizations.activeId()));
    } catch (error) {
      this.mcpError.set(
        error instanceof Error ? error.message : 'The API keys could not be loaded.',
      );
    } finally {
      this.keysLoading.set(false);
    }
  }

  async createKey(): Promise<void> {
    const name = this.keyName().trim();
    if (!name) {
      this.keyError.set('The key needs a name.');
      return;
    }
    if (this.keyScopes().length === 0) {
      this.keyError.set('Choose at least one permission for the key.');
      return;
    }

    try {
      const created = await this.keyGateway.create(
        this.organizations.activeId(),
        name,
        this.keyScopes(),
      );
      this.keys.update((keys) => [created.key, ...keys]);
      this.newSecret.set(created.secret);
      this.newKeyName.set(created.key.name);
      this.keyOpen.set(false);
      this.keyName.set('');
      this.keyScopes.set(['read']);
      this.keyError.set('');
      this.mcpError.set('');
    } catch (error) {
      this.keyError.set(
        error instanceof Error ? error.message : 'The key could not be generated.',
      );
    }
  }

  dismissSecret(): void {
    this.newSecret.set('');
    this.newKeyName.set('');
  }

  async revokeKey(keyId: string): Promise<void> {
    try {
      await this.keyGateway.revoke(this.organizations.activeId(), keyId);
      const revokedAt = new Date().toISOString();
      this.keys.update((keys) =>
        keys.map((key) => (key.id === keyId ? { ...key, revokedAt } : key)),
      );
      this.mcpError.set('');
    } catch (error) {
      this.mcpError.set(
        error instanceof Error ? error.message : 'The key could not be revoked.',
      );
    }
  }

  isActive(key: McpKeyView): boolean {
    return key.revokedAt === null;
  }

  keyStatus(key: McpKeyView): 'active' | 'revoked' {
    return this.isActive(key) ? 'active' : 'revoked';
  }

  masked(key: McpKeyView): string {
    return `${key.prefix}••••••••`;
  }

  copy(value: string, id: string): void {
    void navigator.clipboard?.writeText(value);
    this.copied.set(id);
    setTimeout(() => this.copied.set(''), 2000);
  }

  scopeList(scopes: readonly McpScope[]): string {
    return scopes.map((scope) => MCP_SCOPE_LABELS[scope]).join(' · ');
  }
}
