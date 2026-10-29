import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';

export const TRUST_CATEGORY_ORDER = [
  'infrastructure',
  'organizational',
  'product',
  'procedures',
  'data_privacy',
] as const;

export type TrustCategory = (typeof TRUST_CATEGORY_ORDER)[number];

export type ClaimVisibility = 'public' | 'nda' | 'private';

export interface TrustClaimSnapshot {
  id: string;
  organizationId: string;
  category: TrustCategory;
  title: string;
  body: string;
  visibility: ClaimVisibility;
  evidenceCount: number;
  approvedAt: string;
}

/** A tenant-authored statement published on the public trust center. */
export class TrustClaim extends Entity<string> {
  private constructor(
    id: string,
    private readonly _organizationId: string,
    private readonly _category: TrustCategory,
    private readonly _title: string,
    private readonly _body: string,
    private readonly _visibility: ClaimVisibility,
    private readonly _evidenceCount: number,
    private readonly _approvedAt: string,
  ) {
    super(id);
  }

  static restore(snapshot: TrustClaimSnapshot): TrustClaim {
    if (!snapshot.title.trim() || !snapshot.body.trim()) {
      throw new DomainError('A public claim needs a title and text.');
    }
    if (!TRUST_CATEGORY_ORDER.includes(snapshot.category)) {
      throw new DomainError('Unknown trust category.');
    }
    return new TrustClaim(
      snapshot.id,
      snapshot.organizationId,
      snapshot.category,
      snapshot.title,
      snapshot.body,
      snapshot.visibility,
      snapshot.evidenceCount,
      snapshot.approvedAt,
    );
  }

  get organizationId(): string {
    return this._organizationId;
  }

  get category(): TrustCategory {
    return this._category;
  }

  get title(): string {
    return this._title;
  }

  get body(): string {
    return this._body;
  }

  get visibility(): ClaimVisibility {
    return this._visibility;
  }

  get evidenceCount(): number {
    return this._evidenceCount;
  }

  get approvedAt(): string {
    return this._approvedAt;
  }

  get isPublic(): boolean {
    return this._visibility === 'public';
  }

  toSnapshot(): TrustClaimSnapshot {
    return {
      id: this.id,
      organizationId: this._organizationId,
      category: this._category,
      title: this._title,
      body: this._body,
      visibility: this._visibility,
      evidenceCount: this._evidenceCount,
      approvedAt: this._approvedAt,
    };
  }
}
