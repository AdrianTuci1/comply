import { Injectable, inject, signal } from '@angular/core';
import { Member, Role } from '../domain/team/member';
import { MemberRepository } from '../domain/team/member.repository';
import { Result } from '../shared-kernel/result';

export interface InviteMemberCommand {
  organizationId: string;
  email: string;
  role: Role;
}

@Injectable({ providedIn: 'root' })
export class MemberStore {
  private readonly repository = inject(MemberRepository);
  private readonly membersState = signal<readonly Member[]>(this.repository.findAll());

  readonly members = this.membersState.asReadonly();

  membersOf(organizationId: string): readonly Member[] {
    return this.membersState().filter((member) => member.organizationId === organizationId);
  }

  invite(command: InviteMemberCommand): Result<Member> {
    try {
      const member = Member.invite({
        id: `m-${Date.now().toString(36)}`,
        organizationId: command.organizationId,
        email: command.email,
        role: command.role,
      });
      this.repository.add(member);
      this.membersState.update((members) => [member, ...members]);
      return Result.ok(member);
    } catch (error) {
      return Result.fail(error instanceof Error ? error.message : 'The invitation failed.');
    }
  }
}
