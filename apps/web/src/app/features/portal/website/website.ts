import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { McpAccessFacade } from '../../../application/mcp-access.facade';
import { OrganizationStore } from '../../../application/organization.store';
import { TrustCenterFacade } from '../../../application/trust-center.facade';
import { DeploymentMode } from '../../../domain/access/mcp-access';
import { TrustCenterSettingsProps } from '../../../domain/organization/trust-center-settings';
import { formatDate } from '../../../shared/format';
import { Icon } from '../../../shared/icon/icon';
import {
  CLAIM_VISIBILITY_LABELS,
  DEPLOYMENT_MODE_LABELS,
  DOMAIN_STATUS_LABELS,
  TRUST_CATEGORY_LABELS,
} from '../../../shared/i18n/labels';
import { PageHeader } from '../../../shared/page-header/page-header';
import { StatusBadge } from '../../../shared/status-badge/status-badge';

@Component({
  selector: 'app-website',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, Icon, StatusBadge],
  templateUrl: './website.html',
  styleUrl: './website.scss',
})
export class Website {
  private readonly organizations = inject(OrganizationStore);
  private readonly trustCenter = inject(TrustCenterFacade);
  private readonly mcpAccess = inject(McpAccessFacade);

  readonly organization = this.organizations.active;
  readonly settings = computed(() => this.organization().trustCenter);
  readonly copied = signal(false);
  readonly copiedField = signal('');
  readonly logoError = signal('');
  readonly headerError = signal('');

  readonly mcp = computed(() => this.mcpAccess.accessFor(this.organizations.activeId()));
  readonly deploymentMode = computed<DeploymentMode>(() => this.mcp()?.deploymentMode ?? 'managed');
  readonly domainStatus = computed(() => this.mcp()?.domain.status ?? 'unverified');
  readonly domainToken = computed(() => this.mcp()?.domain.token ?? '');
  readonly domainError = signal('');

  readonly deploymentLabels = DEPLOYMENT_MODE_LABELS;
  readonly domainLabels = DOMAIN_STATUS_LABELS;

  readonly claims = computed(() => this.trustCenter.claimsOf(this.organizations.activeId()));

  readonly publicCount = computed(() => this.claims().filter((claim) => claim.isPublic).length);

  readonly categoryLabels = TRUST_CATEGORY_LABELS;
  readonly categories = Object.entries(TRUST_CATEGORY_LABELS).map(([key, label]) => ({
    key,
    label,
  }));
  readonly formatDate = formatDate;
  readonly visibilityLabels = CLAIM_VISIBILITY_LABELS;

  toggle(key: 'published' | 'showEvidence' | 'allowNda'): void {
    const settings = this.settings();
    this.organizations.updateTrustCenter({
      [key]: !settings[key],
    } as Partial<TrustCenterSettingsProps>);
  }

  setDomain(value: string): void {
    this.organizations.updateTrustCenter({ domain: value.trim() });
  }

  copyLink(): void {
    const url = `${location.origin}/t/${this.organization().slug}`;
    void navigator.clipboard?.writeText(url);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  uploadLogo(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.logoError.set('The file must be an image.');
      input.value = '';
      return;
    }
    if (file.size > 512 * 1024) {
      this.logoError.set('The image must be at most 512 KB.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.organizations.updateTrustCenter({ logoUrl: String(reader.result) });
      this.logoError.set('');
      input.value = '';
    };
    reader.onerror = () => this.logoError.set('The image could not be read.');
    reader.readAsDataURL(file);
  }

  removeLogo(): void {
    this.organizations.updateTrustCenter({ logoUrl: undefined });
    this.logoError.set('');
  }

  uploadHeader(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.headerError.set('The file must be an image.');
      input.value = '';
      return;
    }
    if (file.size > 512 * 1024) {
      this.headerError.set('The image must be at most 512 KB.');
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.organizations.updateTrustCenter({ headerUrl: String(reader.result) });
      this.headerError.set('');
      input.value = '';
    };
    reader.onerror = () => this.headerError.set('The image could not be read.');
    reader.readAsDataURL(file);
  }

  removeHeader(): void {
    this.organizations.updateTrustCenter({ headerUrl: undefined });
    this.headerError.set('');
  }

  setDeploymentMode(value: string): void {
    const mode: DeploymentMode = value === 'self_hosted' ? 'self_hosted' : 'managed';
    const result = this.mcpAccess.setDeploymentMode(this.organizations.activeId(), mode);
    this.domainError.set(result.isFailure ? result.error! : '');
  }

  beginDomainCheck(): void {
    this.applyDomain(this.mcpAccess.beginDomainCheck(this.organizations.activeId()));
  }

  verifyDomain(): void {
    this.applyDomain(this.mcpAccess.verifyDomain(this.organizations.activeId()));
  }

  resetDomain(): void {
    this.applyDomain(this.mcpAccess.resetDomain(this.organizations.activeId()));
  }

  copyToken(): void {
    const token = this.domainToken();
    if (!token) return;
    void navigator.clipboard?.writeText(token);
    this.copiedField.set('token');
    setTimeout(() => this.copiedField.set(''), 2000);
  }

  private applyDomain(result: { isFailure: boolean; error: string | null }): void {
    this.domainError.set(result.isFailure ? result.error! : '');
  }
}
