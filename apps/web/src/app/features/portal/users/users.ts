import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MemberStore } from '../../../application/member.store';
import { OrganizationStore } from '../../../application/organization.store';
import { relativeTime } from '../../../shared/format';
import { Role } from '../../../domain/team/member';
import { ROLE_LABELS } from '../../../shared/i18n/labels';
import { Avatar } from '../../../shared/avatar/avatar';
import { Icon } from '../../../shared/icon/icon';
import { Modal } from '../../../shared/modal/modal';
import { PageHeader } from '../../../shared/page-header/page-header';
import { StatusBadge } from '../../../shared/status-badge/status-badge';

@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, StatusBadge, Avatar, Icon, Modal],
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users {
  private readonly memberStore = inject(MemberStore);
  private readonly organizations = inject(OrganizationStore);

  readonly query = signal('');
  readonly roleFilter = signal<Role | 'all'>('all');
  readonly inviteOpen = signal(false);
  readonly inviteEmail = signal('');
  readonly inviteRole = signal<Role>('contributor');
  readonly inviteError = signal('');

  readonly roleOptions: { value: Role; label: string }[] = [
    { value: 'owner', label: ROLE_LABELS.owner },
    { value: 'admin', label: ROLE_LABELS.admin },
    { value: 'reviewer', label: ROLE_LABELS.reviewer },
    { value: 'contributor', label: ROLE_LABELS.contributor },
    { value: 'auditor', label: ROLE_LABELS.auditor },
  ];

  readonly members = computed(() => this.memberStore.membersOf(this.organizations.activeId()));

  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const role = this.roleFilter();

    return this.members().filter((member) => {
      const matchesRole = role === 'all' || member.role === role;
      const matchesQuery =
        !query ||
        member.name.toLowerCase().includes(query) ||
        member.email.toLowerCase().includes(query);
      return matchesRole && matchesQuery;
    });
  });

  readonly activeCount = computed(() => this.members().filter((member) => member.isActive).length);

  readonly relativeTime = relativeTime;

  openInvite(): void {
    this.inviteEmail.set('');
    this.inviteRole.set('contributor');
    this.inviteError.set('');
    this.inviteOpen.set(true);
  }

  submitInvite(): void {
    const result = this.memberStore.invite({
      organizationId: this.organizations.activeId(),
      email: this.inviteEmail().trim(),
      role: this.inviteRole(),
    });

    if (result.isFailure) {
      this.inviteError.set(result.error!);
      return;
    }

    this.inviteOpen.set(false);
  }
}
