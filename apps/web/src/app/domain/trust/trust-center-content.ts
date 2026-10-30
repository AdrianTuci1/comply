import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';
import { FrameworkId, isFrameworkId } from '../compliance/framework';

export const RESOURCE_CATEGORY_ORDER = ['documents', 'privacy'] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORY_ORDER)[number];

export const COMPLIANCE_STATUSES = ['aligned', 'in_progress', 'not_started'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const UPDATE_TAGS = ['general', 'security', 'subprocessors', 'privacy'] as const;
export type UpdateTag = (typeof UPDATE_TAGS)[number];

export interface TrustResourceSnapshot {
  id: string;
  organizationId: string;
  category: ResourceCategory;
  title: string;
  description: string;
  /** Full text shown when a public resource is opened. */
  body: string;
  gated: boolean;
  updatedAt: string;
}

/** A downloadable document or policy listed on the public page. */
export class TrustResource extends Entity<string> {
  private constructor(private readonly props: TrustResourceSnapshot) {
    super(props.id);
  }

  static restore(snapshot: TrustResourceSnapshot): TrustResource {
    if (!snapshot.title.trim() || !snapshot.description.trim()) {
      throw new DomainError('A resource needs a title and description.');
    }
    if (!snapshot.body.trim()) {
      throw new DomainError('A resource needs content that can be opened.');
    }
    if (!RESOURCE_CATEGORY_ORDER.includes(snapshot.category)) {
      throw new DomainError('Unknown resource category.');
    }
    return new TrustResource({ ...snapshot });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get category(): ResourceCategory {
    return this.props.category;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get body(): string {
    return this.props.body;
  }

  get gated(): boolean {
    return this.props.gated;
  }

  get updatedAt(): string {
    return this.props.updatedAt;
  }

  toSnapshot(): TrustResourceSnapshot {
    return { ...this.props };
  }
}

export interface SubprocessorSnapshot {
  id: string;
  organizationId: string;
  name: string;
  purpose: string;
  region: string;
  initials: string;
  accent: string;
}

/** A third party that processes data on behalf of the tenant. */
export class Subprocessor extends Entity<string> {
  private constructor(private readonly props: SubprocessorSnapshot) {
    super(props.id);
  }

  static restore(snapshot: SubprocessorSnapshot): Subprocessor {
    if (!snapshot.name.trim() || !snapshot.purpose.trim() || !snapshot.region.trim()) {
      throw new DomainError('A subprocessor needs a name, purpose, and region.');
    }
    return new Subprocessor({ ...snapshot });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get purpose(): string {
    return this.props.purpose;
  }

  get region(): string {
    return this.props.region;
  }

  get initials(): string {
    return this.props.initials;
  }

  get accent(): string {
    return this.props.accent;
  }

  toSnapshot(): SubprocessorSnapshot {
    return { ...this.props };
  }
}

export interface TrustUpdateSnapshot {
  id: string;
  organizationId: string;
  title: string;
  body: string;
  tag: UpdateTag;
  publishedAt: string;
}

/** A dated communication shown in the Updates tab. */
export class TrustUpdate extends Entity<string> {
  private constructor(private readonly props: TrustUpdateSnapshot) {
    super(props.id);
  }

  static restore(snapshot: TrustUpdateSnapshot): TrustUpdate {
    if (!snapshot.title.trim() || !snapshot.body.trim()) {
      throw new DomainError('An update needs a title and text.');
    }
    if (!UPDATE_TAGS.includes(snapshot.tag)) {
      throw new DomainError('Unknown update tag.');
    }
    return new TrustUpdate({ ...snapshot });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get tag(): UpdateTag {
    return this.props.tag;
  }

  get publishedAt(): string {
    return this.props.publishedAt;
  }

  toSnapshot(): TrustUpdateSnapshot {
    return { ...this.props };
  }
}

export interface ComplianceProfileSnapshot {
  id: string;
  organizationId: string;
  frameworkId: FrameworkId;
  status: ComplianceStatus;
  note: string;
  since: string;
}

/**
 * A framework the tenant claims alignment with.
 * The status stops at "aligned" / "in progress": the product does not certify.
 */
export class ComplianceProfile extends Entity<string> {
  private constructor(private readonly props: ComplianceProfileSnapshot) {
    super(props.id);
  }

  static restore(snapshot: ComplianceProfileSnapshot): ComplianceProfile {
    if (!isFrameworkId(snapshot.frameworkId)) {
      throw new DomainError('Unknown compliance framework.');
    }
    if (!COMPLIANCE_STATUSES.includes(snapshot.status)) {
      throw new DomainError('Unknown compliance status.');
    }
    if (!snapshot.note.trim()) {
      throw new DomainError('An alignment entry needs a note.');
    }
    return new ComplianceProfile({ ...snapshot });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get frameworkId(): FrameworkId {
    return this.props.frameworkId;
  }

  get status(): ComplianceStatus {
    return this.props.status;
  }

  get note(): string {
    return this.props.note;
  }

  get since(): string {
    return this.props.since;
  }

  toSnapshot(): ComplianceProfileSnapshot {
    return { ...this.props };
  }
}
