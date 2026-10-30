import { Injectable } from '@angular/core';
import {
  ComplianceProfile,
  Subprocessor,
  TrustResource,
  TrustUpdate,
} from '../../domain/trust/trust-center-content';
import { TrustCenterContentRepository } from '../../domain/trust/trust-center-content.repository';
import {
  COMPLIANCE_PROFILE_FIXTURES,
  SUBPROCESSOR_FIXTURES,
  TRUST_RESOURCE_FIXTURES,
  TRUST_UPDATE_FIXTURES,
} from './fixtures/trust-center-content.fixtures';

@Injectable()
export class InMemoryTrustCenterContentRepository extends TrustCenterContentRepository {
  private readonly resources = TRUST_RESOURCE_FIXTURES.map((item) => TrustResource.restore(item));
  private readonly subprocessors = SUBPROCESSOR_FIXTURES.map((item) => Subprocessor.restore(item));
  private readonly updates = TRUST_UPDATE_FIXTURES.map((item) => TrustUpdate.restore(item));
  private readonly compliance = COMPLIANCE_PROFILE_FIXTURES.map((item) =>
    ComplianceProfile.restore(item),
  );

  resourcesFor(organizationId: string): readonly TrustResource[] {
    return this.resources.filter((item) => item.organizationId === organizationId);
  }

  subprocessorsFor(organizationId: string): readonly Subprocessor[] {
    return this.subprocessors.filter((item) => item.organizationId === organizationId);
  }

  updatesFor(organizationId: string): readonly TrustUpdate[] {
    return this.updates
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  complianceFor(organizationId: string): readonly ComplianceProfile[] {
    return this.compliance.filter((item) => item.organizationId === organizationId);
  }
}
