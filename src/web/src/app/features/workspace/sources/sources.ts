import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ContentLibraryFacade } from '../../../application/content-library.facade';
import {
  ContentIngestGateway,
  IngestSchedule,
} from '../../../application/ports/content-ingest.gateway';
import {
  SourceDocument,
  SourceDocumentGateway,
  SourceDocumentMeta,
} from '../../../application/ports/source-document.gateway';
import { FrameworkId, FRAMEWORKS } from '../../../domain/compliance/framework';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { formatDate } from '../../../shared/format';
import {
  FRAMEWORK_LABELS,
  FRAMEWORK_MONOGRAMS,
  SOURCE_KIND_LABELS,
  SOURCE_LICENSE_LABELS,
  TRUST_CATEGORY_LABELS,
} from '../../../shared/i18n/labels';
import { Icon } from '../../../shared/icon/icon';
import { Modal } from '../../../shared/modal/modal';
import { PageHeader } from '../../../shared/page-header/page-header';
import { Pagination } from '../../../shared/pagination/pagination';

interface FrameworkCard {
  id: FrameworkId;
  label: string;
  version: string;
  requirementCount: number;
  sources: number;
  requirements: number;
}

@Component({
  selector: 'app-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, Icon, Pagination, Modal, EmptyState],
  templateUrl: './sources.html',
  styleUrl: './sources.scss',
})
export class Sources {
  private readonly library = inject(ContentLibraryFacade);
  private readonly documentGateway = inject(SourceDocumentGateway);
  private readonly ingest = inject(ContentIngestGateway);

  readonly sources = this.library.sources;
  readonly requirements = this.library.requirements;

  readonly documents = signal<readonly SourceDocumentMeta[]>([]);
  readonly documentBySource = computed(
    () => new Map(this.documents().map((document) => [document.sourceId, document])),
  );
  readonly documentOpen = signal(false);
  readonly activeDocument = signal<SourceDocument | null>(null);
  readonly documentBusy = signal(false);
  readonly documentError = signal('');
  readonly schedule = signal<IngestSchedule | null>(null);
  readonly refreshBusy = signal(false);

  readonly scheduleLabel = computed(() => {
    const schedule = this.schedule();
    if (!schedule) return 'Automatic refresh status is unavailable.';
    if (!schedule.enabled) return 'Automatic refresh is disabled.';
    const interval =
      schedule.intervalHours >= 24
        ? `${Math.round(schedule.intervalHours / 24)} days`
        : `${schedule.intervalHours} hours`;
    return schedule.nextRunAt
      ? `Automatic refresh every ${interval} · next ${formatDate(schedule.nextRunAt)}`
      : `Automatic refresh every ${interval}`;
  });

  readonly frameworks = FRAMEWORKS;
  readonly frameworkLabels = FRAMEWORK_LABELS;
  readonly monograms = FRAMEWORK_MONOGRAMS;
  readonly themeLabels = TRUST_CATEGORY_LABELS;
  readonly licenseLabels = SOURCE_LICENSE_LABELS;
  readonly kindLabels = SOURCE_KIND_LABELS;
  readonly formatDate = formatDate;
  readonly pageSize = 8;

  readonly frameworkFilter = signal<'all' | FrameworkId>('all');
  readonly sourceFilter = signal('all');
  readonly query = signal('');
  readonly page = signal(1);

  readonly notice = signal('');
  readonly noticeTone = signal<'success' | 'error'>('success');

  constructor() {
    void this.loadDocuments();
    void this.loadSchedule();
  }

  readonly frameworkCards = computed<FrameworkCard[]>(() => {
    const requirements = this.requirements();
    const sources = this.sources();

    return FRAMEWORKS.map((framework) => ({
      ...framework,
      sources: sources.filter((source) => source.frameworkId === framework.id).length,
      requirements: requirements.filter((requirement) => requirement.frameworkId === framework.id)
        .length,
    }));
  });

  readonly totalRequirements = computed(() => this.requirements().length);

  readonly sourceTitles = computed(
    () => new Map(this.sources().map((source) => [source.id, source.title])),
  );

  readonly visibleSources = computed(() => {
    const framework = this.frameworkFilter();
    return framework === 'all'
      ? this.sources()
      : this.sources().filter((source) => source.frameworkId === framework);
  });

  readonly filteredRequirements = computed(() => {
    const framework = this.frameworkFilter();
    const source = this.sourceFilter();
    const query = this.query().trim().toLowerCase();
    const titles = this.sourceTitles();

    return this.requirements().filter((requirement) => {
      if (framework !== 'all' && requirement.frameworkId !== framework) {
        return false;
      }
      if (source !== 'all' && requirement.sourceId !== source) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        requirement.ref,
        requirement.title,
        requirement.text,
        titles.get(requirement.sourceId),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredRequirements().length / this.pageSize)),
  );

  readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()));

  readonly pagedRequirements = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize;
    return this.filteredRequirements().slice(start, start + this.pageSize);
  });

  readonly selectedSource = computed(() => {
    const id = this.sourceFilter();
    return id === 'all' ? null : (this.library.sourceById(id) ?? null);
  });

  countFor(sourceId: string): number {
    return this.requirements().filter((requirement) => requirement.sourceId === sourceId).length;
  }

  documentFor(sourceId: string): SourceDocumentMeta | undefined {
    return this.documentBySource().get(sourceId);
  }

  async openDocument(sourceId: string): Promise<void> {
    const meta = this.documentFor(sourceId);
    if (!meta) {
      return;
    }

    this.documentOpen.set(true);
    this.documentBusy.set(true);
    this.documentError.set('');
    this.activeDocument.set(null);

    try {
      this.activeDocument.set(await this.documentGateway.get(meta.id));
    } catch {
      this.documentError.set('The document could not be loaded from the backend.');
    } finally {
      this.documentBusy.set(false);
    }
  }

  closeDocument(): void {
    this.documentOpen.set(false);
    this.activeDocument.set(null);
    this.documentError.set('');
  }

  private async loadDocuments(): Promise<void> {
    try {
      this.documents.set(await this.documentGateway.list());
    } catch (error) {
      console.warn('Source documents are unavailable.', error);
    }
  }

  private async loadSchedule(): Promise<void> {
    try {
      this.schedule.set(await this.ingest.schedule());
    } catch (error) {
      console.warn('The refresh schedule is unavailable.', error);
    }
  }

  async refreshFromSources(): Promise<void> {
    if (this.refreshBusy()) return;

    this.refreshBusy.set(true);
    this.showNotice('Fetching the latest documents from the official sources…');
    try {
      let job = await this.ingest.start();
      const deadline = Date.now() + 180_000;
      while (job.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        job = await this.ingest.job(job.id);
      }
      if (job.status !== 'succeeded') {
        throw new Error(job.error ?? 'The document refresh did not finish.');
      }

      await this.library.reload();
      await this.loadDocuments();
      await this.loadSchedule();
      this.showNotice('Documents refreshed from the official sources.');
    } catch (error) {
      this.showNotice(
        error instanceof Error ? error.message : 'The documents could not be refreshed.',
        'error',
      );
    } finally {
      this.refreshBusy.set(false);
    }
  }

  selectFramework(id: FrameworkId): void {
    this.frameworkFilter.update((current) => (current === id ? 'all' : id));
    this.sourceFilter.set('all');
    this.page.set(1);
  }

  clearFramework(): void {
    this.frameworkFilter.set('all');
    this.sourceFilter.set('all');
    this.page.set(1);
  }

  setSource(value: string): void {
    this.sourceFilter.set(value);
    this.page.set(1);
  }

  selectSource(id: string): void {
    this.sourceFilter.update((current) => (current === id ? 'all' : id));
    this.page.set(1);
  }

  setQuery(value: string): void {
    this.query.set(value);
    this.page.set(1);
  }

  private showNotice(message: string, tone: 'success' | 'error' = 'success'): void {
    this.noticeTone.set(tone);
    this.notice.set(message);
  }
}
