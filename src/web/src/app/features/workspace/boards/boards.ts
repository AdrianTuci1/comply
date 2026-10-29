import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AgentAssessmentSummary, AgentGateway } from '../../../application/ports/agent-gateway';
import { ComplianceFacade } from '../../../application/compliance.facade';
import { ContentLibraryFacade } from '../../../application/content-library.facade';
import { OrganizationStore } from '../../../application/organization.store';
import { AssessmentBoard } from '../../../domain/compliance/assessment-board';
import { FRAMEWORKS, FrameworkId } from '../../../domain/compliance/framework';
import { relativeTime } from '../../../shared/format';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { Icon } from '../../../shared/icon/icon';
import { Modal } from '../../../shared/modal/modal';
import { PageHeader } from '../../../shared/page-header/page-header';
import { ProgressBar } from '../../../shared/progress-bar/progress-bar';
import { StatusBadge } from '../../../shared/status-badge/status-badge';

@Component({
  selector: 'app-boards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, ProgressBar, StatusBadge, Icon, Modal, EmptyState],
  templateUrl: './boards.html',
  styleUrl: './boards.scss',
})
export class Boards {
  private readonly compliance = inject(ComplianceFacade);
  private readonly library = inject(ContentLibraryFacade);
  private readonly organizations = inject(OrganizationStore);
  private readonly agents = inject(AgentGateway);
  private readonly router = inject(Router);

  readonly organization = this.organizations.active;
  readonly relativeTime = relativeTime;
  readonly frameworks = FRAMEWORKS;

  readonly frameworkFilter = signal<FrameworkId | 'all'>('all');
  readonly query = signal('');
  readonly showInactive = signal(false);

  readonly notice = signal('');
  readonly noticeTone = signal<'success' | 'error'>('success');

  readonly createOpen = signal(false);
  readonly createName = signal('');
  readonly createFramework = signal<FrameworkId>('nis2');
  readonly createFrom = signal(`${new Date().getFullYear()}-01-01`);
  readonly createTo = signal(`${new Date().getFullYear()}-12-31`);
  readonly createError = signal('');

  readonly boards = computed(() => this.compliance.boardsOf(this.organizations.activeId()));
  readonly agentBoards = signal<readonly AgentAssessmentSummary[]>([]);
  readonly agentLoading = signal(true);
  readonly libraryCount = computed(
    () =>
      this.library
        .requirements()
        .filter((requirement) => requirement.frameworkId === this.createFramework()).length,
  );
  readonly activeCount = computed(() => this.boards().filter((board) => board.isActive).length);
  readonly inactiveCount = computed(() => this.boards().length - this.activeCount());

  readonly visible = computed(() => {
    const framework = this.frameworkFilter();
    const query = this.query().trim().toLowerCase();

    return this.boards().filter((board) => {
      const matchesFramework = framework === 'all' || board.framework.id === framework;
      const matchesQuery =
        !query ||
        board.name.toLowerCase().includes(query) ||
        board.owner.toLowerCase().includes(query);
      const matchesActive = this.showInactive() || board.isActive;
      return matchesFramework && matchesQuery && matchesActive;
    });
  });

  readonly visibleAgentBoards = computed(() => {
    const framework = this.frameworkFilter();
    const query = this.query().trim().toLowerCase();

    return this.agentBoards().filter((board) => {
      const matchesFramework = framework === 'all' || board.framework === framework;
      const matchesQuery =
        !query ||
        board.name.toLowerCase().includes(query) ||
        board.scope.toLowerCase().includes(query);
      return matchesFramework && matchesQuery;
    });
  });

  readonly filterChips: { value: FrameworkId | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    ...FRAMEWORKS.map((framework) => ({ value: framework.id, label: framework.label })),
  ];

  constructor() {
    void this.loadAgentBoards();
  }

  async loadAgentBoards(): Promise<void> {
    this.agentLoading.set(true);
    try {
      this.agentBoards.set(await this.agents.list(this.organizations.activeId()));
    } catch (error) {
      this.showNotice(
        error instanceof Error ? error.message : 'Agent boards could not be loaded.',
        'error',
      );
    } finally {
      this.agentLoading.set(false);
    }
  }

  frameworkLabel(framework: string): string {
    return this.frameworks.find((item) => item.id === framework)?.label ?? framework;
  }

  phaseLabel(phase: string): string {
    const labels: Record<string, string> = {
      scope: 'Confirm scope',
      collect: 'Collect evidence',
      review: 'Review',
      export: 'Ready to export',
      complete: 'Complete',
    };
    return labels[phase] ?? phase;
  }

  year(iso: string): string {
    return iso.slice(0, 4);
  }

  showNotice(message: string, tone: 'success' | 'error'): void {
    this.notice.set(message);
    this.noticeTone.set(tone);
  }

  exportBoard(board: AssessmentBoard): void {
    this.compliance.exportBoard(board);
    this.showNotice(`"${board.name}" was exported.`, 'success');
  }

  deactivate(board: AssessmentBoard): void {
    const result = this.compliance.deactivateBoard(board.id);
    if (result.isFailure) {
      this.showNotice(result.error!, 'error');
      return;
    }
    this.showNotice(`"${board.name}" was deactivated.`, 'success');
  }

  reactivate(board: AssessmentBoard): void {
    const result = this.compliance.reactivateBoard(board.id);
    if (result.isFailure) {
      this.showNotice(result.error!, 'error');
      return;
    }
    this.showNotice(`"${board.name}" was reactivated.`, 'success');
  }

  async onImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const result = await this.compliance.importBoard(file, this.organizations.activeId());
    if (result.isFailure) {
      this.showNotice(result.error!, 'error');
      return;
    }

    this.showNotice(`"${result.value.name}" was imported.`, 'success');
    await this.router.navigate(['/workspace/boards', result.value.id]);
  }

  openCreate(): void {
    this.createName.set('');
    this.createFramework.set(this.frameworks[0].id);
    this.createFrom.set(`${new Date().getFullYear()}-01-01`);
    this.createTo.set(`${new Date().getFullYear()}-12-31`);
    this.createError.set('');
    this.createOpen.set(true);
  }

  patchDate(key: 'createFrom' | 'createTo', value: string): void {
    if (key === 'createFrom') this.createFrom.set(value);
    else this.createTo.set(value);
  }

  async createBoard(): Promise<void> {
    const framework = this.createFramework();
    const requirements = this.library
      .requirements()
      .filter((requirement) => requirement.frameworkId === framework)
      .map((requirement) => ({
        ref: requirement.ref,
        title: requirement.title,
        description: requirement.text,
      }));

    const result = this.compliance.createBoard({
      organizationId: this.organizations.activeId(),
      name: this.createName(),
      framework,
      from: this.createFrom(),
      to: this.createTo(),
      owner: this.organization().contact.name,
      requirements,
    });

    if (result.isFailure) {
      this.createError.set(result.error!);
      return;
    }

    this.createOpen.set(false);
    this.showNotice(`"${result.value.name}" was created.`, 'success');
    await this.router.navigate(['/workspace/boards', result.value.id]);
  }
}
