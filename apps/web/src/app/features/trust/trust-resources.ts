import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FileDownloader } from '../../application/ports/file-downloader';
import {
  ResourceCategory,
  RESOURCE_CATEGORY_ORDER,
  TrustResource,
} from '../../domain/trust/trust-center-content';
import { formatDateEn } from '../../shared/format';
import { Icon } from '../../shared/icon/icon';
import { Modal } from '../../shared/modal/modal';
import { Pagination } from '../../shared/pagination/pagination';
import { RESOURCE_CATEGORY_LABELS } from './trust-labels';

const PAGE_SIZE = 6;

@Component({
  selector: 'app-trust-resources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Modal, Pagination],
  templateUrl: './trust-resources.html',
  styleUrl: './trust-resources.scss',
})
export class TrustResources implements OnInit, AfterViewInit {
  private readonly downloader = inject(FileDownloader);

  readonly slug = input.required<string>();
  readonly organizationName = input.required<string>();
  readonly resources = input.required<readonly TrustResource[]>();
  readonly allowNda = input(false);

  readonly requestAccess = output<string>();

  readonly selectedCategory = signal<ResourceCategory>('documents');
  readonly query = signal('');
  readonly page = signal(1);
  readonly copiedId = signal<string | null>(null);
  readonly opened = signal<TrustResource | null>(null);
  readonly pageSize = PAGE_SIZE;

  readonly categories = computed(() =>
    RESOURCE_CATEGORY_ORDER.map((category) => ({
      category,
      label: RESOURCE_CATEGORY_LABELS[category],
      count: this.resources().filter((resource) => resource.category === category).length,
    })).filter((entry) => entry.count > 0),
  );

  readonly activeCategory = computed(() => {
    const categories = this.categories();
    if (categories.length === 0) return 'documents' as ResourceCategory;
    return categories.some((entry) => entry.category === this.selectedCategory())
      ? this.selectedCategory()
      : categories[0].category;
  });

  readonly activeLabel = computed(() => RESOURCE_CATEGORY_LABELS[this.activeCategory()]);

  readonly filtered = computed<readonly TrustResource[]>(() => {
    const term = this.query().trim().toLocaleLowerCase('en');
    const inCategory = this.resources().filter(
      (resource) => resource.category === this.activeCategory(),
    );
    if (!term) return inCategory;
    return inCategory.filter(
      (resource) =>
        resource.title.toLocaleLowerCase('en').includes(term) ||
        resource.description.toLocaleLowerCase('en').includes(term),
    );
  });

  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)));

  readonly currentPage = computed(() => Math.min(this.page(), this.pages()));

  readonly visible = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });

  ngOnInit(): void {
    const target = this.hashTarget();
    if (!target) return;
    this.selectedCategory.set(target.category);
    this.page.set(1);
  }

  ngAfterViewInit(): void {
    const target = this.hashTarget();
    if (!target) return;
    // The router aligns fragments to the viewport edge; the sticky header needs an offset.
    setTimeout(() => document.getElementById(target.id)?.scrollIntoView({ block: 'start' }));
  }

  private hashTarget(): TrustResource | undefined {
    const id = location.hash.slice(1);
    return id ? this.resources().find((resource) => resource.id === id) : undefined;
  }

  selectCategory(category: ResourceCategory): void {
    this.selectedCategory.set(category);
    this.page.set(1);
  }

  search(value: string): void {
    this.query.set(value);
    this.page.set(1);
  }

  async copyLink(resource: TrustResource): Promise<void> {
    const link = `${location.origin}/t/${this.slug()}/resources#${resource.id}`;
    try {
      await navigator.clipboard.writeText(link);
      this.copiedId.set(resource.id);
      setTimeout(() => {
        if (this.copiedId() === resource.id) this.copiedId.set(null);
      }, 2200);
    } catch {
      this.copiedId.set(null);
    }
  }

  open(resource: TrustResource): void {
    this.opened.set(resource);
  }

  close(): void {
    this.opened.set(null);
  }

  paragraphs(resource: TrustResource): readonly string[] {
    return resource.body.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
  }

  openDocument(resource: TrustResource): void {
    const blob = new Blob([resource.body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  downloadDocument(resource: TrustResource): void {
    this.downloader.save(
      `${this.slug()}-${resource.id}.txt`,
      resource.body,
      'text/plain;charset=utf-8',
    );
  }

  /** Exports the published list, never the gated documents themselves. */
  exportList(): void {
    const payload = {
      schema: 'comply.trust.resources',
      version: 1,
      organization: this.organizationName(),
      generatedAt: new Date().toISOString(),
      resources: this.resources().map((resource) => ({
        id: resource.id,
        category: resource.category,
        title: resource.title,
        description: resource.description,
        access: resource.gated ? 'request' : 'public',
        updatedAt: resource.updatedAt,
      })),
    };
    this.downloader.save(
      `resources-${this.slug()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  }

  readonly formatDate = formatDateEn;

  categoryLabel(category: ResourceCategory): string {
    return RESOURCE_CATEGORY_LABELS[category];
  }
}
