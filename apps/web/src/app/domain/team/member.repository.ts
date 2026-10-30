import { Member } from './member';

/** Port: persistence boundary for team members. */
export abstract class MemberRepository {
  abstract findAll(): readonly Member[];
  abstract add(member: Member): void;
  abstract save(member: Member): void;
}
