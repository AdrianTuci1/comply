import { DomainError } from '../../shared-kernel/domain-error';
import { Member } from './member';

describe('Member (entity)', () => {
  it('creates an invited member from an email', () => {
    const member = Member.invite({
      id: 'm-1',
      organizationId: 'org-1',
      email: 'Ana.Popescu@Nordwind.ro',
      role: 'reviewer',
    });

    expect(member.email).toBe('ana.popescu@nordwind.ro');
    expect(member.name).toBe('ana popescu');
    expect(member.status).toBe('invited');
    expect(member.isInvited).toBe(true);
    expect(member.isActive).toBe(false);
  });

  it('rejects invalid emails before the UI sees the member', () => {
    expect(() =>
      Member.invite({
        id: 'm-1',
        organizationId: 'org-1',
        email: 'not-an-email',
        role: 'contributor',
      }),
    ).toThrow(DomainError);
  });

  it('changes status while keeping identity', () => {
    const member = Member.invite({
      id: 'm-1',
      organizationId: 'org-1',
      email: 'ana@nordwind.ro',
      role: 'contributor',
    });
    const active = member.withStatus('active');

    expect(active.id).toBe(member.id);
    expect(active.isActive).toBe(true);
    expect(active.equals(member)).toBe(true);
  });
});
