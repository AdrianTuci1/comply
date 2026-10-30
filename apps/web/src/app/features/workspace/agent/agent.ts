import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AgentAssessment,
  AgentAssessmentSummary,
  AgentGateway,
} from '../../../application/ports/agent-gateway';
import { OrganizationStore } from '../../../application/organization.store';
import { apiAbsoluteUrl } from '../../../infrastructure/http/api-url';
import { relativeTime } from '../../../shared/format';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { Icon } from '../../../shared/icon/icon';
import { PageHeader } from '../../../shared/page-header/page-header';
import { ProgressBar } from '../../../shared/progress-bar/progress-bar';

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

const ITEM_LABELS: Record<string, string> = {
  open: 'Open',
  evidence_collected: 'Evidence collected',
  completed: 'Completed',
  not_applicable: 'Not applicable',
};

@Component({
  selector: 'app-agent-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, ProgressBar, EmptyState, Icon],
  templateUrl: './agent.html',
  styleUrl: './agent.scss',
})
export class AgentGuide implements OnDestroy {
  private readonly gateway = inject(AgentGateway);
  private readonly organizations = inject(OrganizationStore);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly organization = this.organizations.active;
  readonly relativeTime = relativeTime;
  readonly phaseLabels = PHASE_LABELS;
  readonly frameworkLabels = FRAMEWORK_LABELS;
  readonly itemLabels = ITEM_LABELS;

  readonly assessments = signal<readonly AgentAssessmentSummary[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly detail = signal<AgentAssessment | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly copied = signal('');

  readonly endpoint = apiAbsoluteUrl('/mcp');
  readonly tenant = this.organizations.activeId();
  readonly bearer = '<paste your MCP key>';
  readonly config = JSON.stringify(
    {
      mcpServers: {
        comply: {
          type: 'http',
          url: this.endpoint,
          headers: {
            Authorization: `Bearer ${this.bearer}`,
          },
        },
      },
    },
    null,
    2,
  );

  readonly selectedSummary = computed(() =>
    this.assessments().find((item) => item.assessment_id === this.selectedId()),
  );

  constructor() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(true), 3000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const list = await this.gateway.list(this.tenant);
      this.assessments.set(list);
      const selected = this.selectedId();
      const nextId =
        selected && list.some((item) => item.assessment_id === selected)
          ? selected
          : (list[0]?.assessment_id ?? null);
      if (nextId !== this.selectedId()) {
        this.selectedId.set(nextId);
        this.detail.set(null);
      }
      if (nextId) await this.loadDetail(nextId);
      this.error.set('');
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'The agent assessments could not be loaded.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  async select(id: string): Promise<void> {
    this.selectedId.set(id);
    await this.loadDetail(id);
  }

  private async loadDetail(id: string): Promise<void> {
    try {
      this.detail.set(await this.gateway.get(this.tenant, id));
    } catch (error) {
      this.detail.set(null);
      this.error.set(
        error instanceof Error ? error.message : 'The assessment could not be loaded.',
      );
    }
  }

  async copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(label);
      setTimeout(() => this.copied.set(''), 2000);
    } catch {
      this.copied.set('Copy is unavailable in this browser.');
    }
  }

  phaseLabel(phase: string): string {
    return PHASE_LABELS[phase] ?? phase;
  }

  frameworkLabel(framework: string): string {
    return FRAMEWORK_LABELS[framework] ?? framework;
  }

  itemLabel(status: string): string {
    return ITEM_LABELS[status] ?? status;
  }
}
