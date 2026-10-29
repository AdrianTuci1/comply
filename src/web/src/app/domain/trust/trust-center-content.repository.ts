import {
  ComplianceProfile,
  Subprocessor,
  TrustResource,
  TrustUpdate,
} from './trust-center-content';

/** Port: read model for the non-claim sections of a public trust center. */
export abstract class TrustCenterContentRepository {
  abstract resourcesFor(organizationId: string): readonly TrustResource[];
  abstract subprocessorsFor(organizationId: string): readonly Subprocessor[];
  abstract updatesFor(organizationId: string): readonly TrustUpdate[];
  abstract complianceFor(organizationId: string): readonly ComplianceProfile[];
}
