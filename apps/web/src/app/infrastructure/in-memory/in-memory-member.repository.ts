import { Injectable } from '@angular/core';
import { Member } from '../../domain/team/member';
import { MemberRepository } from '../../domain/team/member.repository';
import { MEMBER_FIXTURES } from './fixtures/member.fixtures';

@Injectable()
export class InMemoryMemberRepository extends MemberRepository {
  private readonly store = new Map<string, Member>();

  constructor() {
    super();
    for (const fixture of MEMBER_FIXTURES) {
      this.store.set(fixture.id, Member.restore(fixture));
    }
  }

  findAll(): readonly Member[] {
    return [...this.store.values()];
  }

  add(member: Member): void {
    this.store.set(member.id, member);
  }

  save(member: Member): void {
    this.store.set(member.id, member);
  }
}
