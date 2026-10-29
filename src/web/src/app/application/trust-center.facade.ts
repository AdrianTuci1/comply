import { Injectable, inject } from '@angular/core';
import {
  ComplianceProfile,
  Subprocessor,
  TrustResource,
  TrustUpdate,
} from '../domain/trust/trust-center-content';
import { TrustCenterContentRepository } from '../domain/trust/trust-center-content.repository';
import { TRUST_CATEGORY_ORDER, TrustCategory, TrustClaim } from '../domain/trust/trust-claim';
import { TrustClaimRepository } from '../domain/trust/trust-claim.repository';

export interface ClaimGroup {
  category: TrustCategory;
  claims: readonly TrustClaim[];
}

/** Read model for the public trust center. */
@Injectable({ providedIn: 'root' })
export class TrustCenterFacade {
  private readonly repository = inject(TrustClaimRepository);
  private readonly content = inject(TrustCenterContentRepository);

  claimsOf(organizationId: string): readonly TrustClaim[] {
    return this.repository.findAll().filter((claim) => claim.organizationId === organizationId);
  }

  publicClaimsOf(organizationId: string): readonly TrustClaim[] {
    return this.repository.findPublicByOrganization(organizationId);
  }

  groupsFor(organizationId: string): readonly ClaimGroup[] {
    const claims = this.publicClaimsOf(organizationId);
    return TRUST_CATEGORY_ORDER.map((category) => ({
      category,
      claims: claims.filter((claim) => claim.category === category),
    })).filter((group) => group.claims.length > 0);
  }

  resourcesFor(organizationId: string): readonly TrustResource[] {
    return this.content.resourcesFor(organizationId);
  }

  subprocessorsFor(organizationId: string): readonly Subprocessor[] {
    return this.content.subprocessorsFor(organizationId);
  }

  updatesFor(organizationId: string): readonly TrustUpdate[] {
    return this.content.updatesFor(organizationId);
  }

  complianceFor(organizationId: string): readonly ComplianceProfile[] {
    return this.content.complianceFor(organizationId);
  }

  /** Latest date across claims, resources and updates, so the pill stays honest. */
  lastUpdatedOf(organizationId: string): string | null {
    const dates = [
      ...this.publicClaimsOf(organizationId).map((claim) => claim.approvedAt),
      ...this.resourcesFor(organizationId).map((resource) => resource.updatedAt),
      ...this.updatesFor(organizationId).map((update) => update.publishedAt),
    ].sort((a, b) => b.localeCompare(a));
    return dates[0] ?? null;
  }
}
