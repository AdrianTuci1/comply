import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TrustUpdate, UpdateTag } from '../../domain/trust/trust-center-content';
import { formatDateEn } from '../../shared/format';
import { Pagination } from '../../shared/pagination/pagination';
import { UPDATE_TAG_LABELS } from './trust-labels';

const PAGE_SIZE = 4;

@Component({
  selector: 'app-trust-updates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Pagination],
  templateUrl: './trust-updates.html',
  styleUrl: './trust-updates.scss',
})
export class TrustUpdates {
  readonly updates = input.required<readonly TrustUpdate[]>();

  readonly page = signal(1);
  readonly expandedId = signal<string | null>(null);
  readonly pageSize = PAGE_SIZE;

  readonly pages = computed(() => Math.max(1, Math.ceil(this.updates().length / PAGE_SIZE)));

  readonly currentPage = computed(() => Math.min(this.page(), this.pages()));

  readonly visible = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.updates().slice(start, start + PAGE_SIZE);
  });

  toggle(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  tagLabel(tag: UpdateTag): string {
    return UPDATE_TAG_LABELS[tag];
  }

  readonly formatDate = formatDateEn;
}
