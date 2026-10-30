import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Subprocessor } from '../../domain/trust/trust-center-content';
import { Icon } from '../../shared/icon/icon';
import { Pagination } from '../../shared/pagination/pagination';

const PAGE_SIZE = 10;

@Component({
  selector: 'app-trust-subprocessors',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Pagination],
  templateUrl: './trust-subprocessors.html',
  styleUrl: './trust-subprocessors.scss',
})
export class TrustSubprocessors {
  readonly subprocessors = input.required<readonly Subprocessor[]>();

  readonly query = signal('');
  readonly page = signal(1);
  readonly pageSize = PAGE_SIZE;

  readonly filtered = computed<readonly Subprocessor[]>(() => {
    const term = this.query().trim().toLocaleLowerCase('en');
    const items = this.subprocessors();
    if (!term) return items;
    return items.filter(
      (item) =>
        item.name.toLocaleLowerCase('en').includes(term) ||
        item.purpose.toLocaleLowerCase('en').includes(term) ||
        item.region.toLocaleLowerCase('en').includes(term),
    );
  });

  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)));

  readonly currentPage = computed(() => Math.min(this.page(), this.pages()));

  readonly visible = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });

  search(value: string): void {
    this.query.set(value);
    this.page.set(1);
  }
}
