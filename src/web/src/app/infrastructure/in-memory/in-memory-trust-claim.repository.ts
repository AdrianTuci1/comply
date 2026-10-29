import { Injectable } from '@angular/core';
import { TrustClaim } from '../../domain/trust/trust-claim';
import { TrustClaimRepository } from '../../domain/trust/trust-claim.repository';
import { TRUST_CLAIM_FIXTURES } from './fixtures/trust-claim.fixtures';

@Injectable()
export class InMemoryTrustClaimRepository extends TrustClaimRepository {
  private readonly claims = TRUST_CLAIM_FIXTURES.map((fixture) => TrustClaim.restore(fixture));

  findAll(): readonly TrustClaim[] {
    return this.claims;
  }

  findPublicByOrganization(organizationId: string): readonly TrustClaim[] {
    return this.claims.filter((claim) => claim.organizationId === organizationId && claim.isPublic);
  }
}
