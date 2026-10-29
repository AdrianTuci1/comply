import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClaimGroup } from '../../application/trust-center.facade';
import {
  ComplianceProfile,
  ComplianceStatus,
  Subprocessor,
  TrustResource,
  TrustUpdate,
  UpdateTag,
} from '../../domain/trust/trust-center-content';
import { FrameworkId } from '../../domain/compliance/framework';
import { formatDateEn, relativeTimeEn } from '../../shared/format';
import { FRAMEWORK_LABELS, FRAMEWORK_MONOGRAMS } from '../../shared/i18n/labels';
import { Icon } from '../../shared/icon/icon';
import { COMPLIANCE_STATUS_LABELS, TRUST_CATEGORY_LABELS, UPDATE_TAG_LABELS } from './trust-labels';

interface ControlCardView {
  category: string;
  label: string;
  preview: ClaimGroup['claims'];
  total: number;
}

@Component({
  selector: 'app-trust-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  templateUrl: './trust-overview.html',
  styleUrl: './trust-overview.scss',
})
export class TrustOverview {
  readonly slug = input.required<string>();
  readonly groups = input.required<readonly ClaimGroup[]>();
  readonly compliance = input.required<readonly ComplianceProfile[]>();
  readonly resources = input.required<readonly TrustResource[]>();
  readonly subprocessors = input.required<readonly Subprocessor[]>();
  readonly updates = input.required<readonly TrustUpdate[]>();
  readonly lastUpdated = input<string | null>(null);
  readonly allowNda = input(false);

  readonly requestAccess = output<string | undefined>();

  readonly controlCards = computed<ControlCardView[]>(() =>
    this.groups().map((group) => ({
      category: group.category,
      label: TRUST_CATEGORY_LABELS[group.category],
      preview: group.claims.slice(0, 3),
      total: group.claims.length,
    })),
  );

  readonly documents = computed(() =>
    this.resources()
      .filter((resource) => resource.category === 'documents')
      .slice(0, 4),
  );

  readonly privacy = computed(() =>
    this.resources()
      .filter((resource) => resource.category === 'privacy')
      .slice(0, 2),
  );

  readonly topSubprocessors = computed(() => this.subprocessors().slice(0, 4));
  readonly topUpdates = computed(() => this.updates().slice(0, 2));

  tabLink(tab: string): readonly string[] {
    return ['/t', this.slug(), tab];
  }

  frameworkLabel(frameworkId: FrameworkId): string {
    return FRAMEWORK_LABELS[frameworkId];
  }

  monogram(frameworkId: FrameworkId): string {
    return FRAMEWORK_MONOGRAMS[frameworkId];
  }

  statusLabel(status: ComplianceStatus): string {
    return COMPLIANCE_STATUS_LABELS[status];
  }

  tagLabel(tag: UpdateTag): string {
    return UPDATE_TAG_LABELS[tag];
  }

  readonly formatDate = formatDateEn;
  readonly relativeTime = relativeTimeEn;
}
