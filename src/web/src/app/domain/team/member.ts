import { DomainError } from '../../shared-kernel/domain-error';
import { Entity } from '../../shared-kernel/entity';

export type Role = 'owner' | 'admin' | 'reviewer' | 'contributor' | 'auditor';
export type MemberStatus = 'active' | 'invited' | 'disabled';

export interface MemberSnapshot {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  lastSeen?: string;
}

export interface InviteMemberInput {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  now?: Date;
}

/** A person with access to exactly one organization. */
export class Member extends Entity<string> {
  private constructor(
    id: string,
    private readonly _organizationId: string,
    private readonly _name: string,
    private readonly _email: string,
    private readonly _role: Role,
    private readonly _status: MemberStatus,
    private readonly _lastSeen: string | undefined,
  ) {
    super(id);
  }

  static restore(snapshot: MemberSnapshot): Member {
    return new Member(
      snapshot.id,
      snapshot.organizationId,
      snapshot.name,
      snapshot.email,
      snapshot.role,
      snapshot.status,
      snapshot.lastSeen,
    );
  }

  /** Factory that keeps invitation rules in one place. */
  static invite(input: InviteMemberInput): Member {
    const email = input.email.trim().toLowerCase();
    if (!Member.isEmail(email)) {
      throw new DomainError('Enter a valid email address.');
    }
    const name = email.split('@')[0].replace(/[._-]+/g, ' ');
    return new Member(
      input.id,
      input.organizationId,
      name,
      email,
      input.role,
      'invited',
      undefined,
    );
  }

  get organizationId(): string {
    return this._organizationId;
  }

  get name(): string {
    return this._name;
  }

  get email(): string {
    return this._email;
  }

  get role(): Role {
    return this._role;
  }

  get status(): MemberStatus {
    return this._status;
  }

  get lastSeen(): string | undefined {
    return this._lastSeen;
  }

  get isActive(): boolean {
    return this._status === 'active';
  }

  get isInvited(): boolean {
    return this._status === 'invited';
  }

  withStatus(status: MemberStatus): Member {
    return new Member(
      this.id,
      this._organizationId,
      this._name,
      this._email,
      this._role,
      status,
      this._lastSeen,
    );
  }

  toSnapshot(): MemberSnapshot {
    return {
      id: this.id,
      organizationId: this._organizationId,
      name: this._name,
      email: this._email,
      role: this._role,
      status: this._status,
      lastSeen: this._lastSeen,
    };
  }

  private static isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
