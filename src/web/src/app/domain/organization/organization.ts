import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';
import { ValueObject } from '../../shared-kernel/value-object';
import { TrustCenterSettings, TrustCenterSettingsProps } from './trust-center-settings';

export type OrganizationPlan = 'free' | 'team' | 'enterprise';

export class ContactPerson extends ValueObject<{ name: string; email: string }> {
  private constructor(props: { name: string; email: string }) {
    super(props);
  }

  static create(name: string, email: string): ContactPerson {
    if (!name.trim()) throw new DomainError('The contact person name is required.');
    if (!email.includes('@')) throw new DomainError('The contact email address is invalid.');
    return new ContactPerson({ name: name.trim(), email: email.trim() });
  }

  get name(): string {
    return this.props.name;
  }

  get email(): string {
    return this.props.email;
  }
}

export interface OrganizationProfile {
  name?: string;
  cui?: string;
  contactName?: string;
  contactEmail?: string;
  retentionDays?: number;
  sealedMode?: boolean;
}

export interface OrganizationSnapshot {
  id: string;
  name: string;
  cui: string;
  slug: string;
  plan: OrganizationPlan;
  initials: string;
  accent: string;
  contactName: string;
  contactEmail: string;
  trustCenter: TrustCenterSettingsProps;
  retentionDays: number;
  sealedMode: boolean;
}

/**
 * Aggregate root for a customer organization.
 * Profile and trust-center settings change only through the methods below,
 * so invariants (valid contact, retention window, domain) hold everywhere.
 */
export class Organization extends Entity<string> {
  private constructor(
    id: string,
    private readonly _name: string,
    private readonly _cui: string,
    private readonly _slug: string,
    private readonly _plan: OrganizationPlan,
    private readonly _initials: string,
    private readonly _accent: string,
    private readonly _contact: ContactPerson,
    private readonly _trustCenter: TrustCenterSettings,
    private readonly _retentionDays: number,
    private readonly _sealedMode: boolean,
  ) {
    super(id);
  }

  static restore(snapshot: OrganizationSnapshot): Organization {
    if (!snapshot.name.trim() || !snapshot.slug.trim()) {
      throw new DomainError('The organization needs a name and slug.');
    }
    return new Organization(
      snapshot.id,
      snapshot.name,
      snapshot.cui,
      snapshot.slug,
      snapshot.plan,
      snapshot.initials,
      snapshot.accent,
      ContactPerson.create(snapshot.contactName, snapshot.contactEmail),
      TrustCenterSettings.create(snapshot.trustCenter),
      Organization.validRetention(snapshot.retentionDays),
      snapshot.sealedMode,
    );
  }

  get name(): string {
    return this._name;
  }

  get cui(): string {
    return this._cui;
  }

  get slug(): string {
    return this._slug;
  }

  get plan(): OrganizationPlan {
    return this._plan;
  }

  get initials(): string {
    return this._initials;
  }

  get accent(): string {
    return this._accent;
  }

  get contact(): ContactPerson {
    return this._contact;
  }

  get trustCenter(): TrustCenterSettings {
    return this._trustCenter;
  }

  get retentionDays(): number {
    return this._retentionDays;
  }

  get sealedMode(): boolean {
    return this._sealedMode;
  }

  withProfile(patch: OrganizationProfile): Organization {
    const contact = ContactPerson.create(
      patch.contactName ?? this._contact.name,
      patch.contactEmail ?? this._contact.email,
    );
    const name = (patch.name ?? this._name).trim();
    if (!name) throw new DomainError('The organization name is required.');

    return new Organization(
      this.id,
      name,
      patch.cui ?? this._cui,
      this._slug,
      this._plan,
      this._initials,
      this._accent,
      contact,
      this._trustCenter,
      patch.retentionDays === undefined
        ? this._retentionDays
        : Organization.validRetention(patch.retentionDays),
      patch.sealedMode ?? this._sealedMode,
    );
  }

  withTrustCenter(patch: Partial<TrustCenterSettingsProps>): Organization {
    return new Organization(
      this.id,
      this._name,
      this._cui,
      this._slug,
      this._plan,
      this._initials,
      this._accent,
      this._contact,
      this._trustCenter.with(patch),
      this._retentionDays,
      this._sealedMode,
    );
  }

  toSnapshot(): OrganizationSnapshot {
    return {
      id: this.id,
      name: this._name,
      cui: this._cui,
      slug: this._slug,
      plan: this._plan,
      initials: this._initials,
      accent: this._accent,
      contactName: this._contact.name,
      contactEmail: this._contact.email,
      trustCenter: this._trustCenter.toJSON(),
      retentionDays: this._retentionDays,
      sealedMode: this._sealedMode,
    };
  }

  private static validRetention(days: number): number {
    if (!Number.isInteger(days) || days < 30) {
      throw new DomainError('Retention must be at least 30 days.');
    }
    return days;
  }
}
