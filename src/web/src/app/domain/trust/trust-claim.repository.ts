import { TrustClaim } from './trust-claim';

/** Port: read model of tenant-authored trust claims. */
export abstract class TrustClaimRepository {
  abstract findAll(): readonly TrustClaim[];
  abstract findPublicByOrganization(organizationId: string): readonly TrustClaim[];
}
