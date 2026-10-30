import { FrameworkId, isFrameworkId } from '../compliance/framework';
import { TRUST_CATEGORY_ORDER, TrustCategory } from '../trust/trust-claim';
import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';

export const CONTENT_STATUSES = ['draft', 'in_review', 'published'] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export interface ContentRequirementSnapshot {
  id: string;
  sourceId: string;
  frameworkId: FrameworkId;
  ref: string;
  title: string;
  text: string;
  theme: TrustCategory;
  status: ContentStatus;
  reviewer: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** A requirement extracted from a source document, waiting for human review. */
export class ContentRequirement extends Entity<string> {
  private constructor(
    id: string,
    private readonly _sourceId: string,
    private readonly _frameworkId: FrameworkId,
    private readonly _ref: string,
    private readonly _title: string,
    private readonly _text: string,
    private readonly _theme: TrustCategory,
    private readonly _status: ContentStatus,
    private readonly _reviewer: string | null,
    private readonly _reviewedAt: string | null,
    private readonly _createdAt: string,
  ) {
    super(id);
  }

  static create(props: {
    id: string;
    sourceId: string;
    frameworkId: FrameworkId;
    ref: string;
    title: string;
    text: string;
    theme: TrustCategory;
    createdAt: string;
  }): ContentRequirement {
    return new ContentRequirement(
      props.id,
      props.sourceId,
      props.frameworkId,
      requireRef(props.ref),
      requireTitle(props.title),
      requireText(props.text),
      requireTheme(props.theme),
      'draft',
      null,
      null,
      props.createdAt,
    );
  }

  static restore(snapshot: ContentRequirementSnapshot): ContentRequirement {
    if (!isFrameworkId(snapshot.frameworkId)) {
      throw new DomainError('Unknown framework for the requirement.');
    }
    if (!CONTENT_STATUSES.includes(snapshot.status)) {
      throw new DomainError('Unknown requirement status.');
    }
    if (snapshot.status === 'published' && !snapshot.reviewer?.trim()) {
      throw new DomainError('A published requirement needs a reviewer.');
    }
    return new ContentRequirement(
      snapshot.id,
      snapshot.sourceId,
      snapshot.frameworkId,
      requireRef(snapshot.ref),
      requireTitle(snapshot.title),
      requireText(snapshot.text),
      requireTheme(snapshot.theme),
      snapshot.status,
      snapshot.reviewer,
      snapshot.reviewedAt,
      snapshot.createdAt,
    );
  }

  get sourceId(): string {
    return this._sourceId;
  }

  get frameworkId(): FrameworkId {
    return this._frameworkId;
  }

  get ref(): string {
    return this._ref;
  }

  get title(): string {
    return this._title;
  }

  get text(): string {
    return this._text;
  }

  get theme(): TrustCategory {
    return this._theme;
  }

  get status(): ContentStatus {
    return this._status;
  }

  get reviewer(): string | null {
    return this._reviewer;
  }

  get reviewedAt(): string | null {
    return this._reviewedAt;
  }

  get createdAt(): string {
    return this._createdAt;
  }

  get isPublished(): boolean {
    return this._status === 'published';
  }

  revise(patch: { title: string; text: string; theme: TrustCategory }): ContentRequirement {
    if (this.isPublished) {
      throw new DomainError('A published requirement can no longer be edited.');
    }
    return new ContentRequirement(
      this.id,
      this._sourceId,
      this._frameworkId,
      this._ref,
      requireTitle(patch.title),
      requireText(patch.text),
      requireTheme(patch.theme),
      this._status,
      this._reviewer,
      this._reviewedAt,
      this._createdAt,
    );
  }

  sendToReview(): ContentRequirement {
    if (this.isPublished) {
      throw new DomainError('The requirement is already published.');
    }
    return new ContentRequirement(
      this.id,
      this._sourceId,
      this._frameworkId,
      this._ref,
      this._title,
      this._text,
      this._theme,
      'in_review',
      this._reviewer,
      this._reviewedAt,
      this._createdAt,
    );
  }

  publish(reviewer: string, reviewedAt: string): ContentRequirement {
    const name = reviewer.trim();
    if (!name) {
      throw new DomainError('Publicarea are nevoie de numele recenzorului.');
    }
    if (!reviewedAt.trim()) {
      throw new DomainError('Publishing needs a review date.');
    }
    return new ContentRequirement(
      this.id,
      this._sourceId,
      this._frameworkId,
      this._ref,
      this._title,
      this._text,
      this._theme,
      'published',
      name,
      reviewedAt,
      this._createdAt,
    );
  }

  toSnapshot(): ContentRequirementSnapshot {
    return {
      id: this.id,
      sourceId: this._sourceId,
      frameworkId: this._frameworkId,
      ref: this._ref,
      title: this._title,
      text: this._text,
      theme: this._theme,
      status: this._status,
      reviewer: this._reviewer,
      reviewedAt: this._reviewedAt,
      createdAt: this._createdAt,
    };
  }
}

function requireRef(value: string): string {
  const ref = value.trim();
  if (!ref) {
    throw new DomainError('The requirement reference is required.');
  }
  return ref;
}

function requireTitle(value: string): string {
  const title = value.trim();
  if (!title) {
    throw new DomainError('The requirement title is required.');
  }
  return title;
}

function requireText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new DomainError('The requirement text is required.');
  }
  return text;
}

function requireTheme(value: TrustCategory): TrustCategory {
  if (!TRUST_CATEGORY_ORDER.includes(value)) {
    throw new DomainError('Unknown requirement theme.');
  }
  return value;
}
