import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ClaimGroup } from '../../application/trust-center.facade';
import { TrustCategory, TrustClaim } from '../../domain/trust/trust-claim';
import { relativeTimeEn } from '../../shared/format';
import { Icon } from '../../shared/icon/icon';
import { TRUST_CATEGORY_LABELS } from './trust-labels';

interface ControlGroupView {
  category: string;
  label: string;
  claims: readonly TrustClaim[];
}

@Component({
  selector: 'app-trust-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './trust-controls.html',
  styleUrl: './trust-controls.scss',
})
export class TrustControls {
  readonly groups = input.required<readonly ClaimGroup[]>();
  readonly categoryLabels = input<Record<TrustCategory, string>>(TRUST_CATEGORY_LABELS);
  readonly lastUpdated = input<string | null>(null);

  readonly query = signal('');

  readonly filteredGroups = computed<readonly ControlGroupView[]>(() => {
    const term = this.query().trim().toLocaleLowerCase('en');
    return this.groups()
      .map((group) => ({
        category: group.category,
        label: this.categoryLabels()[group.category],
        claims: term
          ? group.claims.filter(
              (claim) =>
                claim.title.toLocaleLowerCase('en').includes(term) ||
                claim.body.toLocaleLowerCase('en').includes(term),
            )
          : group.claims,
      }))
      .filter((group) => group.claims.length > 0);
  });

  readonly total = computed(() =>
    this.filteredGroups().reduce((sum, group) => sum + group.claims.length, 0),
  );

  search(value: string): void {
    this.query.set(value);
  }

  scrollTo(category: string): void {
    document.getElementById(category)?.scrollIntoView({ block: 'start' });
  }

  readonly relativeTime = relativeTimeEn;
}
