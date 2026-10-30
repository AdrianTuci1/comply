import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { OrganizationStore } from '../../application/organization.store';
import { ClaimGroup, TrustCenterFacade } from '../../application/trust-center.facade';
import { TRUST_CATEGORY_ORDER, TrustCategory } from '../../domain/trust/trust-claim';
import { relativeTimeEn } from '../../shared/format';
import { Icon } from '../../shared/icon/icon';
import { TrustAccessDialog, AccessDialogMode } from './trust-access-dialog';
import { TrustControls } from './trust-controls';
import { TrustHeader } from './trust-header';
import { TRUST_CATEGORY_LABELS, TRUST_TABS, TrustTab } from './trust-labels';
import { TrustOverview } from './trust-overview';
import { TrustResources } from './trust-resources';
import { TrustSubprocessors } from './trust-subprocessors';
import { TrustUpdates } from './trust-updates';

@Component({
  selector: 'app-trust-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Icon,
    TrustHeader,
    TrustOverview,
    TrustControls,
    TrustResources,
    TrustSubprocessors,
    TrustUpdates,
    TrustAccessDialog,
  ],
  templateUrl: './trust-page.html',
  styleUrl: './trust-page.scss',
  host: {
    '[style.--trust-accent]': 'accent()',
  },
})
export class TrustPage {
  private readonly organizations = inject(OrganizationStore);
  private readonly trustCenter = inject(TrustCenterFacade);

  readonly slug = input.required<string>();
  readonly tab = input('overview');

  readonly tenant = computed(() => this.organizations.findBySlug(this.slug()));

  /** Unpublished pages behave like a 404, so tenant existence is not leaked. */
  readonly pageTenant = computed(() => {
    const tenant = this.tenant();
    return tenant?.trustCenter.isPublic ? tenant : null;
  });

  readonly accent = computed(() => this.tenant()?.accent ?? '#0f9d76');

  readonly activeTab = computed<TrustTab>(() => {
    const requested = this.tab() as TrustTab;
    return this.tabs().some((entry) => entry.key === requested) ? requested : 'overview';
  });

  readonly publicClaims = computed(() => {
    const tenant = this.pageTenant();
    return tenant ? this.trustCenter.publicClaimsOf(tenant.id) : [];
  });

  readonly groups = computed<readonly ClaimGroup[]>(() => {
    const tenant = this.pageTenant();
    if (!tenant) return [];
    return this.trustCenter
      .groupsFor(tenant.id)
      .filter((group) => tenant.trustCenter.isCategoryVisible(group.category));
  });

  readonly categoryLabels = computed<Record<TrustCategory, string>>(() => {
    const settings = this.pageTenant()?.trustCenter;
    const labels = {} as Record<TrustCategory, string>;
    for (const category of TRUST_CATEGORY_ORDER) {
      labels[category] = settings
        ? settings.categoryLabel(category, TRUST_CATEGORY_LABELS[category])
        : TRUST_CATEGORY_LABELS[category];
    }
    return labels;
  });

  readonly resources = computed(() => {
    const tenant = this.pageTenant();
    return tenant ? this.trustCenter.resourcesFor(tenant.id) : [];
  });

  readonly subprocessors = computed(() => {
    const tenant = this.pageTenant();
    if (!tenant) return [];
    return this.trustCenter
      .subprocessorsFor(tenant.id)
      .filter((item) => tenant.trustCenter.isSubprocessorPublished(item.id));
  });

  readonly updates = computed(() => {
    const tenant = this.pageTenant();
    return tenant ? this.trustCenter.updatesFor(tenant.id) : [];
  });

  readonly compliance = computed(() => {
    const tenant = this.pageTenant();
    return tenant ? this.trustCenter.complianceFor(tenant.id) : [];
  });

  /** Sections without published content stay hidden, so the page follows the settings. */
  readonly tabs = computed(() => {
    const availability: Partial<Record<TrustTab, boolean>> = {
      resources: this.resources().length > 0,
      controls: this.groups().length > 0,
      subprocessors: this.subprocessors().length > 0,
      updates: this.updates().length > 0,
    };
    return TRUST_TABS.filter((tab) => availability[tab.key] ?? true);
  });

  readonly lastUpdated = computed(() => {
    const tenant = this.pageTenant();
    return tenant ? this.trustCenter.lastUpdatedOf(tenant.id) : null;
  });

  readonly showTop = signal(false);

  readonly dialog = signal<AccessDialogMode | null>(null);
  readonly dialogSubject = signal<string | null>(null);

  tabLink(tab: TrustTab): readonly string[] {
    return tab === 'overview' ? ['/t', this.slug()] : ['/t', this.slug(), tab];
  }

  openAccess(subject?: string): void {
    this.dialogSubject.set(subject ?? null);
    this.dialog.set('access');
  }

  openSubscribe(): void {
    this.dialog.set('subscribe');
  }

  closeDialog(): void {
    this.dialog.set(null);
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.showTop.set(window.scrollY > 560);
  }

  scrollTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  readonly relativeTime = relativeTimeEn;
}
