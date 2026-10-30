import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';
import { AssessmentPeriod } from './assessment-period';
import { BoardProgress } from './board-progress';
import { ChecklistItem, ChecklistItemSnapshot } from './checklist-item';
import { FrameworkId, FrameworkRef } from './framework';
import { ItemStatus } from './item-status';

export type BoardStatus = 'draft' | 'in_progress' | 'in_review' | 'complete';

const BOARD_TRANSITIONS: Record<BoardStatus, readonly BoardStatus[]> = {
  draft: ['in_progress', 'in_review'],
  in_progress: ['draft', 'in_review'],
  in_review: ['in_progress', 'complete'],
  complete: ['in_review'],
};

export interface AssessmentBoardSnapshot {
  id: string;
  organizationId: string;
  name: string;
  framework: FrameworkId;
  frameworkVersion: string;
  periodFrom: string;
  periodTo: string;
  status: BoardStatus;
  active?: boolean;
  total: number;
  accepted: number;
  proposed: number;
  gaps: number;
  owner: string;
  updatedAt: string;
  items: ChecklistItemSnapshot[];
}

export interface BoardRequirementSeed {
  ref: string;
  title: string;
  description: string;
}

export interface CreateAssessmentBoardInput {
  id: string;
  organizationId: string;
  name: string;
  framework: FrameworkId;
  period: AssessmentPeriod;
  owner: string;
  requirements?: readonly BoardRequirementSeed[];
  now?: Date;
}

export interface ImportBoardOptions {
  id: string;
  organizationId: string;
  now?: Date;
}

interface AssessmentBoardProps {
  id: string;
  organizationId: string;
  name: string;
  framework: FrameworkRef;
  period: AssessmentPeriod;
  status: BoardStatus;
  active: boolean;
  progress: BoardProgress;
  owner: string;
  updatedAt: string;
  items: readonly ChecklistItem[];
}

/**
 * Aggregate root for one assessment board.
 * The checklist, status and progress counters change together, which keeps
 * coverage numbers consistent on every screen that reads the board.
 */
export class AssessmentBoard extends Entity<string> {
  private constructor(private readonly props: AssessmentBoardProps) {
    super(props.id);
  }

  static create(input: CreateAssessmentBoardInput): AssessmentBoard {
    const name = input.name.trim();
    if (name.length < 3) {
      throw new DomainError('The board name must be at least 3 characters.');
    }
    if (!input.owner.trim()) {
      throw new DomainError('The board needs an owner.');
    }

    const framework = FrameworkRef.of(input.framework);
    const now = (input.now ?? new Date()).toISOString();
    const owner = input.owner.trim();
    const items = (input.requirements ?? []).map((requirement, index) =>
      ChecklistItem.restore({
        id: `${input.id}-${index}`,
        ref: requirement.ref,
        title: requirement.title,
        description: requirement.description,
        status: 'not_started',
        evidenceCount: 0,
        owner,
        updatedAt: now,
      }),
    );

    return new AssessmentBoard({
      id: input.id,
      organizationId: input.organizationId,
      name,
      framework,
      period: input.period,
      status: 'draft',
      active: true,
      progress: BoardProgress.create({
        total: items.length > 0 ? items.length : framework.requirementCount,
        accepted: 0,
        proposed: 0,
        gaps: 0,
      }),
      owner,
      updatedAt: now,
      items,
    });
  }

  static restore(snapshot: AssessmentBoardSnapshot): AssessmentBoard {
    return new AssessmentBoard({
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      name: snapshot.name,
      framework: FrameworkRef.restore(snapshot.framework, snapshot.frameworkVersion),
      period: AssessmentPeriod.create(snapshot.periodFrom, snapshot.periodTo),
      status: snapshot.status,
      active: snapshot.active ?? true,
      progress: BoardProgress.create({
        total: snapshot.total,
        accepted: snapshot.accepted,
        proposed: snapshot.proposed,
        gaps: snapshot.gaps,
      }),
      owner: snapshot.owner,
      updatedAt: snapshot.updatedAt,
      items: snapshot.items.map((item) => ChecklistItem.restore(item)),
    });
  }

  /** Rehydrates an exported board as a new assessment in another organization. */
  static importCopy(
    snapshot: AssessmentBoardSnapshot,
    options: ImportBoardOptions,
  ): AssessmentBoard {
    const source = AssessmentBoard.restore(snapshot);
    const now = (options.now ?? new Date()).toISOString();
    const items = source.items.map((item, index) =>
      ChecklistItem.restore({
        ...item.toSnapshot(),
        id: `${options.id}-${index}`,
        updatedAt: now,
      }),
    );

    return new AssessmentBoard({
      id: options.id,
      organizationId: options.organizationId,
      name: `${source.name} (import)`,
      framework: source.framework,
      period: source.period,
      status: source.status,
      active: true,
      progress: source.progress,
      owner: source.owner,
      updatedAt: now,
      items,
    });
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get framework(): FrameworkRef {
    return this.props.framework;
  }

  get period(): AssessmentPeriod {
    return this.props.period;
  }

  get status(): BoardStatus {
    return this.props.status;
  }

  get isActive(): boolean {
    return this.props.active;
  }

  get progress(): BoardProgress {
    return this.props.progress;
  }

  get owner(): string {
    return this.props.owner;
  }

  get updatedAt(): string {
    return this.props.updatedAt;
  }

  get items(): readonly ChecklistItem[] {
    return this.props.items;
  }

  get coverage(): number {
    return this.props.progress.coverage;
  }

  get total(): number {
    return this.props.progress.total;
  }

  get accepted(): number {
    return this.props.progress.accepted;
  }

  get proposed(): number {
    return this.props.progress.proposed;
  }

  get gaps(): number {
    return this.props.progress.gaps;
  }

  get frameworkVersion(): string {
    return this.props.framework.version;
  }

  get periodFrom(): string {
    return this.props.period.from;
  }

  get periodTo(): string {
    return this.props.period.to;
  }

  get canBeSentToReview(): boolean {
    return BOARD_TRANSITIONS[this.props.status].includes('in_review');
  }

  itemById(itemId: string): ChecklistItem | undefined {
    return this.props.items.find((item) => item.id === itemId);
  }

  countByStatus(status: ItemStatus): number {
    return this.props.items.filter((item) => item.status === status).length;
  }

  changeItemStatus(itemId: string, status: ItemStatus, now = new Date()): AssessmentBoard {
    const item = this.requireItem(itemId);
    if (item.status === status) return this;

    const updated = item.moveTo(status, now);
    const progress = this.props.progress.applyStatusChange(item.status, status);

    return this.withProps({
      progress,
      items: this.replaceItem(updated),
      updatedAt: now.toISOString(),
    });
  }

  saveConclusion(itemId: string, conclusion: string, now = new Date()): AssessmentBoard {
    const item = this.requireItem(itemId);
    return this.withProps({
      items: this.replaceItem(item.withConclusion(conclusion, now)),
      updatedAt: now.toISOString(),
    });
  }

  sendToReview(now = new Date()): AssessmentBoard {
    if (!this.canBeSentToReview) {
      throw new DomainError(
        `The board cannot be sent to review from status "${this.props.status}".`,
      );
    }
    return this.withProps({
      status: 'in_review',
      updatedAt: now.toISOString(),
    });
  }

  deactivate(now = new Date()): AssessmentBoard {
    if (!this.props.active) return this;
    return this.withProps({ active: false, updatedAt: now.toISOString() });
  }

  reactivate(now = new Date()): AssessmentBoard {
    if (this.props.active) return this;
    return this.withProps({ active: true, updatedAt: now.toISOString() });
  }

  toSnapshot(): AssessmentBoardSnapshot {
    return {
      id: this.id,
      organizationId: this.props.organizationId,
      name: this.props.name,
      framework: this.props.framework.id,
      frameworkVersion: this.props.framework.version,
      periodFrom: this.props.period.from,
      periodTo: this.props.period.to,
      status: this.props.status,
      active: this.props.active,
      total: this.props.progress.total,
      accepted: this.props.progress.accepted,
      proposed: this.props.progress.proposed,
      gaps: this.props.progress.gaps,
      owner: this.props.owner,
      updatedAt: this.props.updatedAt,
      items: this.props.items.map((item) => item.toSnapshot()),
    };
  }

  private requireItem(itemId: string): ChecklistItem {
    const item = this.itemById(itemId);
    if (!item) {
      throw new DomainError(`Requirement "${itemId}" does not exist on the board.`);
    }
    return item;
  }

  private replaceItem(updated: ChecklistItem): readonly ChecklistItem[] {
    return this.props.items.map((item) => (item.id === updated.id ? updated : item));
  }

  private withProps(patch: Partial<AssessmentBoardProps>): AssessmentBoard {
    return new AssessmentBoard({ ...this.props, ...patch });
  }
}
