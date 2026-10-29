import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FileDownloader } from '../../../application/ports/file-downloader';
import { ComplianceFacade } from '../../../application/compliance.facade';
import { EvidenceArtifact, EvidenceType } from '../../../domain/compliance/evidence-artifact';
import { ItemStatus } from '../../../domain/compliance/item-status';
import { formatDate, relativeTime } from '../../../shared/format';
import { EmptyState } from '../../../shared/empty-state/empty-state';
import { Icon } from '../../../shared/icon/icon';
import {
  EVIDENCE_REVIEW_LABELS,
  EVIDENCE_TYPE_LABELS,
  ITEM_STATUS_LABELS,
} from '../../../shared/i18n/labels';
import { Modal } from '../../../shared/modal/modal';
import { PageHeader } from '../../../shared/page-header/page-header';
import { ProgressBar } from '../../../shared/progress-bar/progress-bar';
import { StatusBadge } from '../../../shared/status-badge/status-badge';

interface PanelNotice {
  message: string;
  tone: 'success' | 'error';
}

@Component({
  selector: 'app-board-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, ProgressBar, StatusBadge, Icon, EmptyState, Modal],
  templateUrl: './board-detail.html',
  styleUrl: './board-detail.scss',
})
export class BoardDetail {
  private readonly compliance = inject(ComplianceFacade);
  private readonly downloader = inject(FileDownloader);

  readonly id = input.required<string>();

  readonly statusFilter = signal<ItemStatus | 'all'>('all');
  readonly query = signal('');
  readonly selectedId = signal<string | null>(null);
  readonly notice = signal<PanelNotice | null>(null);

  readonly board = computed(() => this.compliance.boardById(this.id()));
  readonly items = computed(() => this.board()?.items ?? []);

  readonly filters: { value: ItemStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'not_started', label: ITEM_STATUS_LABELS.not_started },
    { value: 'in_progress', label: ITEM_STATUS_LABELS.in_progress },
    { value: 'proposed', label: ITEM_STATUS_LABELS.proposed },
    { value: 'in_review', label: ITEM_STATUS_LABELS.in_review },
    { value: 'accepted', label: ITEM_STATUS_LABELS.accepted },
    { value: 'rejected', label: ITEM_STATUS_LABELS.rejected },
    { value: 'not_applicable', label: ITEM_STATUS_LABELS.not_applicable },
  ];

  readonly visibleItems = computed(() => {
    const status = this.statusFilter();
    const query = this.query().trim().toLowerCase();

    return this.items().filter((item) => {
      const matchesStatus = status === 'all' || item.status === status;
      const matchesQuery =
        !query ||
        item.ref.toLowerCase().includes(query) ||
        item.title.toLowerCase().includes(query) ||
        (item.description ?? '').toLowerCase().includes(query) ||
        item.owner.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  });

  readonly activeItem = computed(() => {
    const items = this.items();
    return items.find((item) => item.id === this.selectedId()) ?? items[0] ?? null;
  });

  readonly draftConclusion = linkedSignal(() => this.activeItem()?.conclusion ?? '');

  readonly evidenceSlots = computed(() =>
    Array.from({ length: this.activeItem()?.evidenceCount ?? 0 }, (_, index) => index + 1),
  );

  readonly evidence = computed<readonly EvidenceArtifact[]>(() => {
    const item = this.activeItem();
    return item ? this.compliance.evidenceFor(this.id(), item.id) : [];
  });

  readonly openedEvidence = signal<EvidenceArtifact | null>(null);

  readonly evidenceTypeLabels = EVIDENCE_TYPE_LABELS;
  readonly evidenceReviewLabels = EVIDENCE_REVIEW_LABELS;

  readonly formatDate = formatDate;
  readonly relativeTime = relativeTime;

  countFor(status: ItemStatus | 'all'): number {
    const board = this.board();
    if (!board) return 0;
    return status === 'all' ? board.items.length : board.countByStatus(status);
  }

  year(iso: string): string {
    return iso.slice(0, 4);
  }

  isActive(itemId: string): boolean {
    return this.activeItem()?.id === itemId;
  }

  staleMessage(reason: string): string {
    return reason === 'evidence_expired'
      ? 'Evidence has expired. Upload new evidence or reconfirm the conclusion.'
      : 'The requirement changed in the current content version. Reconfirm the conclusion.';
  }

  openEvidence(artifact: EvidenceArtifact): void {
    this.openedEvidence.set(artifact);
  }

  closeEvidence(): void {
    this.openedEvidence.set(null);
  }

  downloadEvidence(artifact: EvidenceArtifact): void {
    this.downloader.save(`${artifact.id}.txt`, artifact.body, 'text/plain;charset=utf-8');
  }

  evidenceTypeLabel(type: EvidenceType): string {
    return EVIDENCE_TYPE_LABELS[type];
  }

  saveConclusion(): void {
    const board = this.board();
    const item = this.activeItem();
    if (!board || !item) return;

    const result = this.compliance.saveConclusion(board.id, item.id, this.draftConclusion());
    this.report(result.isSuccess ? 'The conclusion was saved.' : result.error!, result.isFailure);
  }

  accept(): void {
    this.changeStatus('accepted', 'The requirement was accepted.');
  }

  reject(): void {
    this.changeStatus('rejected', 'The requirement was rejected.');
  }

  markNotApplicable(): void {
    this.changeStatus('not_applicable', 'The requirement was marked not applicable.');
  }

  sendToReview(): void {
    const board = this.board();
    if (!board) return;

    const result = this.compliance.sendToReview(board.id);
    this.report(
      result.isSuccess ? 'The board was sent to review.' : result.error!,
      result.isFailure,
    );
  }

  exportBoard(): void {
    const board = this.board();
    if (!board) return;
    this.compliance.exportBoard(board);
    this.report('The board was exported as JSON.', false);
  }

  private changeStatus(status: ItemStatus, successMessage: string): void {
    const board = this.board();
    const item = this.activeItem();
    if (!board || !item) return;
    if (item.status === status) return;

    const result = this.compliance.changeItemStatus(board.id, item.id, status);
    this.report(result.isSuccess ? successMessage : result.error!, result.isFailure);
  }

  private report(message: string, isError: boolean): void {
    this.notice.set({ message, tone: isError ? 'error' : 'success' });
    setTimeout(() => this.notice.set(null), 3000);
  }
}
