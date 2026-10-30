import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';

export const EVIDENCE_TYPES = [
  'document',
  'screenshot',
  'log_export',
  'api_report',
  'attestation',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_REVIEW_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type EvidenceReviewStatus = (typeof EVIDENCE_REVIEW_STATUSES)[number];

export interface EvidenceArtifactSnapshot {
  id: string;
  organizationId: string;
  boardId: string;
  itemId: string;
  title: string;
  type: EvidenceType;
  source: string;
  collectedAt: string;
  submittedBy: string;
  hash: string;
  reviewStatus: EvidenceReviewStatus;
  /** Readable document body, shown when the artifact is opened. */
  body: string;
}

/** One piece of evidence attached to a checklist item. */
export class EvidenceArtifact extends Entity<string> {
  private constructor(private readonly props: EvidenceArtifactSnapshot) {
    super(props.id);
  }

  static restore(snapshot: EvidenceArtifactSnapshot): EvidenceArtifact {
    if (!snapshot.title.trim()) {
      throw new DomainError('Dovada are nevoie de un titlu.');
    }
    if (!snapshot.source.trim()) {
      throw new DomainError('Evidence needs a source.');
    }
    if (!snapshot.hash.trim()) {
      throw new DomainError('Dovada are nevoie de un hash.');
    }
    if (!snapshot.body.trim()) {
      throw new DomainError('Evidence needs content that can be opened.');
    }
    if (!EVIDENCE_TYPES.includes(snapshot.type)) {
      throw new DomainError('Unknown evidence type.');
    }
    if (!EVIDENCE_REVIEW_STATUSES.includes(snapshot.reviewStatus)) {
      throw new DomainError('Unknown review status.');
    }
    return new EvidenceArtifact({ ...snapshot });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get boardId(): string {
    return this.props.boardId;
  }

  get itemId(): string {
    return this.props.itemId;
  }

  get title(): string {
    return this.props.title;
  }

  get type(): EvidenceType {
    return this.props.type;
  }

  get source(): string {
    return this.props.source;
  }

  get collectedAt(): string {
    return this.props.collectedAt;
  }

  get submittedBy(): string {
    return this.props.submittedBy;
  }

  get hash(): string {
    return this.props.hash;
  }

  get reviewStatus(): EvidenceReviewStatus {
    return this.props.reviewStatus;
  }

  get body(): string {
    return this.props.body;
  }

  get isAccepted(): boolean {
    return this.props.reviewStatus === 'accepted';
  }

  toSnapshot(): EvidenceArtifactSnapshot {
    return { ...this.props };
  }
}
