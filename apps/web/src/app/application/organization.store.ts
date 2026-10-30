import { computed, effect, Injectable, inject, signal } from '@angular/core';
import { ActiveOrganizationStorage } from './ports/active-organization.storage';
import { Organization, OrganizationProfile } from '../domain/organization/organization';
import { OrganizationRepository } from '../domain/organization/organization.repository';
import { TrustCenterSettingsProps } from '../domain/organization/trust-center-settings';

/**
 * Application service for the organization context.
 * Owns the read model (signals) and orchestrates the repository; the UI never
 * touches persistence or reconstructs aggregates.
 */
@Injectable({ providedIn: 'root' })
export class OrganizationStore {
  private readonly repository = inject(OrganizationRepository);
  private readonly storage = inject(ActiveOrganizationStorage);

  private readonly organizationsState = signal<readonly Organization[]>(this.repository.findAll());
  private readonly activeIdState = signal(this.resolveInitialId());

  readonly organizations = this.organizationsState.asReadonly();
  readonly activeId = this.activeIdState.asReadonly();
  readonly active = computed(
    () =>
      this.organizationsState().find((organization) => organization.id === this.activeIdState()) ??
      this.organizationsState()[0],
  );

  constructor() {
    effect(() => this.storage.set(this.activeIdState()));
  }

  switchTo(organizationId: string): void {
    if (this.organizationsState().some((organization) => organization.id === organizationId)) {
      this.activeIdState.set(organizationId);
    }
  }

  findBySlug(slug: string): Organization | undefined {
    return this.organizationsState().find((organization) => organization.slug === slug);
  }

  updateProfile(patch: OrganizationProfile): void {
    this.replace(this.active().withProfile(patch));
  }

  updateTrustCenter(patch: Partial<TrustCenterSettingsProps>): void {
    this.replace(this.active().withTrustCenter(patch));
  }

  private replace(updated: Organization): void {
    this.repository.save(updated);
    this.organizationsState.update((organizations) =>
      organizations.map((organization) =>
        organization.id === updated.id ? updated : organization,
      ),
    );
  }

  private resolveInitialId(): string {
    const stored = this.storage.get();
    const organizations = this.organizationsState();
    return organizations.some((organization) => organization.id === stored)
      ? stored!
      : organizations[0].id;
  }
}
