import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ComplianceFacade } from '../../../application/compliance.facade';
import { MemberStore } from '../../../application/member.store';
import { OrganizationStore } from '../../../application/organization.store';
import { AssessmentBoard } from '../../../domain/compliance/assessment-board';
import { relativeTime } from '../../../shared/format';
import { Icon } from '../../../shared/icon/icon';
import { ITEM_STATUS_LABELS } from '../../../shared/i18n/labels';
import { PageHeader } from '../../../shared/page-header/page-header';
import { ProgressBar } from '../../../shared/progress-bar/progress-bar';
import { StatCard } from '../../../shared/stat-card/stat-card';
import { StatusBadge } from '../../../shared/status-badge/status-badge';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, StatCard, StatusBadge, ProgressBar, Icon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly compliance = inject(ComplianceFacade);
  private readonly memberStore = inject(MemberStore);
  private readonly organizations = inject(OrganizationStore);

  readonly organization = this.organizations.active;

  readonly boards = computed(() => this.compliance.boardsOf(this.organizations.activeId()));
  readonly members = computed(() => this.memberStore.membersOf(this.organizations.activeId()));

  readonly activeMembers = computed(
    () => this.members().filter((member) => member.isActive).length,
  );

  readonly activeBoards = computed(
    () => this.boards().filter((board) => board.status !== 'complete').length,
  );

  readonly openGaps = computed(() => this.boards().reduce((total, board) => total + board.gaps, 0));

  readonly coverage = computed(() => {
    const total = this.boards().reduce((sum, board) => sum + board.total, 0);
    const accepted = this.boards().reduce((sum, board) => sum + board.accepted, 0);
    return total === 0 ? 0 : Math.round((accepted / total) * 100);
  });

  readonly recentBoards = computed(() =>
    [...this.boards()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
  );

  readonly expiring = computed(() => {
    const limit = Date.now() + 90 * 86_400_000;

    return this.boards()
      .flatMap((board) =>
        board.items
          .filter((item) => item.validUntil && new Date(item.validUntil).getTime() <= limit)
          .map((item) => ({
            id: item.id,
            title: item.title,
            validUntil: item.validUntil,
            boardName: board.name,
            daysLeft: Math.ceil(
              (new Date(item.validUntil ?? 0).getTime() - Date.now()) / 86_400_000,
            ),
          })),
      )
      .sort((a, b) => (a.validUntil ?? '').localeCompare(b.validUntil ?? ''))
      .slice(0, 4);
  });

  readonly activity = computed(() =>
    this.boards()
      .flatMap((board) =>
        board.items.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          updatedAt: item.updatedAt,
          boardName: board.name,
          statusLabel: ITEM_STATUS_LABELS[item.status],
        })),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5),
  );

  coverageOf(board: AssessmentBoard): number {
    return board.coverage;
  }

  readonly relativeTime = relativeTime;

  year(iso: string): string {
    return iso.slice(0, 4);
  }
}
