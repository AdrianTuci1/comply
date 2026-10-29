import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from '../icon/icon';

/** Prev/next pagination with a result range, shared by the trust-center lists. */
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (total() > 0) {
      <nav class="pagination" aria-label="Paginare">
        <p class="pagination__summary">
          {{ from() }}–{{ to() }} {{ preposition() }} {{ total() }} {{ label() }}
        </p>
        <div class="pagination__controls">
          <button
            type="button"
            class="pagination__btn"
            [disabled]="current() <= 1"
            [attr.aria-label]="previousLabel()"
            (click)="go(current() - 1)"
          >
            <app-icon name="chevron-left" [size]="16" />
          </button>
          <span class="pagination__page">{{ current() }} / {{ pages() }}</span>
          <button
            type="button"
            class="pagination__btn"
            [disabled]="current() >= pages()"
            [attr.aria-label]="nextLabel()"
            (click)="go(current() + 1)"
          >
            <app-icon name="chevron-right" [size]="16" />
          </button>
        </div>
      </nav>
    }
  `,
  styles: `
    .pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-top: 18px;
    }

    .pagination__summary {
      font-size: 12.5px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .pagination__controls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .pagination__btn {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: #fff;
      color: var(--text);
      cursor: pointer;
    }

    .pagination__btn:hover:not(:disabled) {
      border-color: var(--border-strong);
      background: #f8f9fb;
    }

    .pagination__btn:disabled {
      color: #c4cad3;
      cursor: not-allowed;
    }

    .pagination__page {
      min-width: 46px;
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Pagination {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly label = input('results');
  readonly preposition = input('of');
  readonly previousLabel = input('Previous page');
  readonly nextLabel = input('Next page');
  readonly pageChange = output<number>();

  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly current = computed(() => Math.min(Math.max(1, this.page()), this.pages()));
  readonly from = computed(() =>
    this.total() === 0 ? 0 : (this.current() - 1) * this.pageSize() + 1,
  );
  readonly to = computed(() => Math.min(this.current() * this.pageSize(), this.total()));

  go(page: number): void {
    this.pageChange.emit(Math.min(Math.max(1, page), this.pages()));
  }
}
