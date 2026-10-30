import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AgentAssessment,
  AgentGateway,
  AgentRequirement,
} from '../../../application/ports/agent-gateway';
import { OrganizationStore } from '../../../application/organization.store';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { formatDate, relativeTime } from '../../../shared/format';
import { Icon } from '../../../shared/icon/icon';
import { PageHeader } from '../../../shared/page-header/page-header';
import { ProgressBar } from '../../../shared/progress-bar/progress-bar';

type RequirementStatus = AgentRequirement['status'];

const PHASE_LABELS: Record<string, string> = {
  scope: 'Confirm scope',
  collect: 'Collect evidence',
  review: 'Review',
  export: 'Ready to export',
  complete: 'Complete',
};

const FRAMEWORK_LABELS: Record<string, string> = {
  nis2: 'NIS2',
  iso27001: 'ISO/IEC 27001',
  'ai-act': 'EU AI Act',
  soc2: 'SOC 2',
};

const STATUS_LABELS: Record<RequirementStatus, string> = {
  open: 'Open',
  evidence_collected: 'Evidence collected',
  completed: 'Completed',
  not_applicable: 'Not applicable',
};

@Component({
  selector: 'app-agent-board-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, ProgressBar, EmptyState, Icon],
  templateUrl: './agent-board-detail.html',
  styleUrl: './agent-board-detail.scss',
})
export class AgentBoardDetail implements OnInit, OnDestroy {
  private readonly gateway = inject(AgentGateway);
  private readonly organizations = inject(OrganizationStore);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly id = input.required<string>();
  readonly assessment = signal<AgentAssessment | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly query = signal('');
  readonly statusFilter = signal<RequirementStatus | 'all'>('all');

  readonly phaseLabels = PHASE_LABELS;
  readonly frameworkLabels = FRAMEWORK_LABELS;
  readonly statusLabels = STATUS_LABELS;
  readonly formatDate = formatDate;
  readonly relativeTime = relativeTime;

  readonly filters: { value: RequirementStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'open', label: STATUS_LABELS.open },
    { value: 'evidence_collected', label: STATUS_LABELS.evidence_collected },
    { value: 'completed', label: STATUS_LABELS.completed },
    { value: 'not_applicable', label: STATUS_LABELS.not_applicable },
  ];

  readonly requirements = computed(() => this.assessment()?.items ?? []);

  readonly visible = computed(() => {
    const status = this.statusFilter();
    const query = this.query().trim().toLowerCase();

    return this.requirements().filter((item) => {
      const matchesStatus = status === 'all' || item.status === status;
      const matchesQuery =
        !query ||
        item.ref.toLowerCase().includes(query) ||
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        (item.conclusion ?? '').toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  });

  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => void this.load(true), 4000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      this.assessment.set(await this.gateway.get(this.organizations.activeId(), this.id()));
      this.error.set('');
    } catch (error) {
      if (!silent) {
        this.error.set(
          error instanceof Error ? error.message : 'The agent board could not be loaded.',
        );
      }
    } finally {
      this.loading.set(false);
    }
  }

  countFor(status: RequirementStatus | 'all'): number {
    return status === 'all'
      ? this.requirements().length
      : this.requirements().filter((item) => item.status === status).length;
  }

  frameworkLabel(framework: string): string {
    return FRAMEWORK_LABELS[framework] ?? framework;
  }

  phaseLabel(phase: string): string {
    return PHASE_LABELS[phase] ?? phase;
  }
}
