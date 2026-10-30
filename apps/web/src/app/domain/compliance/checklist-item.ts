import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';
import { ItemStatus, ItemWorkflow, StaleReason } from './item-status';

export interface ChecklistItemSnapshot {
  id: string;
  ref: string;
  title: string;
  description?: string;
  status: ItemStatus;
  evidenceCount: number;
  owner: string;
  updatedAt: string;
  conclusion?: string;
  validUntil?: string;
  staleReason?: StaleReason;
}

interface ChecklistItemProps {
  id: string;
  ref: string;
  title: string;
  description?: string;
  status: ItemStatus;
  evidenceCount: number;
  owner: string;
  updatedAt: string;
  conclusion?: string;
  validUntil?: string;
  staleReason?: StaleReason;
}

/**
 * Entity inside the assessment board aggregate.
 * All mutators return a new instance; the aggregate decides when to persist it.
 */
export class ChecklistItem extends Entity<string> {
  private constructor(private readonly props: ChecklistItemProps) {
    super(props.id);
  }

  static restore(snapshot: ChecklistItemSnapshot): ChecklistItem {
    if (!snapshot.ref.trim() || !snapshot.title.trim()) {
      throw new DomainError('A requirement needs a reference and title.');
    }
    if (snapshot.evidenceCount < 0) {
      throw new DomainError('The evidence count cannot be negative.');
    }
    return new ChecklistItem({ ...snapshot });
  }

  get ref(): string {
    return this.props.ref;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string | undefined {
    return this.props.description;
  }

  get status(): ItemStatus {
    return this.props.status;
  }

  get evidenceCount(): number {
    return this.props.evidenceCount;
  }

  get owner(): string {
    return this.props.owner;
  }

  get updatedAt(): string {
    return this.props.updatedAt;
  }

  get conclusion(): string | undefined {
    return this.props.conclusion;
  }

  get validUntil(): string | undefined {
    return this.props.validUntil;
  }

  get staleReason(): StaleReason | undefined {
    return this.props.staleReason;
  }

  get isStale(): boolean {
    return this.props.staleReason !== undefined;
  }

  get isAccepted(): boolean {
    return this.props.status === 'accepted';
  }

  /** Business rule: no evidence, no acceptance. */
  get canBeAccepted(): boolean {
    return this.props.evidenceCount > 0;
  }

  isExpired(now: Date): boolean {
    return !!this.props.validUntil && this.props.validUntil < now.toISOString().slice(0, 10);
  }

  moveTo(status: ItemStatus, now = new Date()): ChecklistItem {
    ItemWorkflow.assertTransition(this.props.status, status);
    if (status === 'accepted' && !this.canBeAccepted) {
      throw new DomainError(
        `"${this.props.title}" cannot be accepted without at least one piece of evidence.`,
      );
    }
    return new ChecklistItem({
      ...this.props,
      status,
      staleReason: undefined,
      updatedAt: now.toISOString(),
    });
  }

  withConclusion(conclusion: string, now = new Date()): ChecklistItem {
    return new ChecklistItem({
      ...this.props,
      conclusion: conclusion.trim() || undefined,
      updatedAt: now.toISOString(),
    });
  }

  withEvidence(evidenceCount: number, now = new Date()): ChecklistItem {
    if (evidenceCount < 0) {
      throw new DomainError('The evidence count cannot be negative.');
    }
    return new ChecklistItem({
      ...this.props,
      evidenceCount,
      staleReason: undefined,
      updatedAt: now.toISOString(),
    });
  }

  toSnapshot(): ChecklistItemSnapshot {
    return { ...this.props };
  }
}
