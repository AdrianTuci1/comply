import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  BOARD_STATUS_LABELS,
  DOMAIN_STATUS_LABELS,
  ITEM_STATUS_LABELS,
  PLAN_LABELS,
  ROLE_LABELS,
} from '../i18n/labels';

export type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'violet';

type Kind = 'item' | 'board' | 'member' | 'plan' | 'role' | 'publish' | 'domain' | 'key';

const TONES: Record<string, Tone> = {
  accepted: 'success',
  complete: 'success',
  active: 'success',
  published: 'success',
  proposed: 'violet',
  in_review: 'info',
  in_progress: 'warn',
  invited: 'warn',
  rejected: 'danger',
  revoked: 'danger',
  not_started: 'neutral',
  not_applicable: 'neutral',
  unverified: 'neutral',
  pending: 'warn',
  verified: 'success',
  draft: 'neutral',
  disabled: 'neutral',
  owner: 'violet',
  admin: 'info',
  reviewer: 'success',
  contributor: 'neutral',
  auditor: 'warn',
  enterprise: 'violet',
  team: 'info',
  free: 'neutral',
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [class]="'badge--' + tone()">
      <span class="badge__dot"></span>
      {{ label() }}
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 560;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .badge__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .badge--neutral {
      background: #f1f3f6;
      color: #667085;
    }
    .badge--success {
      background: var(--accent-soft);
      color: var(--accent-strong);
    }
    .badge--warn {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .badge--danger {
      background: var(--danger-soft);
      color: var(--danger);
    }
    .badge--info {
      background: var(--info-soft);
      color: var(--info);
    }
    .badge--violet {
      background: var(--violet-soft);
      color: var(--violet);
    }
  `,
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly kind = input<Kind>('item');

  readonly label = computed(() => {
    const status = this.status();
    switch (this.kind()) {
      case 'board':
        return BOARD_STATUS_LABELS[status as keyof typeof BOARD_STATUS_LABELS] ?? status;
      case 'member':
        return status === 'active' ? 'Active' : status === 'invited' ? 'Invited' : 'Deactivated';
      case 'plan':
        return PLAN_LABELS[status as keyof typeof PLAN_LABELS] ?? status;
      case 'role':
        return ROLE_LABELS[status as keyof typeof ROLE_LABELS] ?? status;
      case 'publish':
        return status === 'published' ? 'Published' : 'Unpublished';
      case 'domain':
        return DOMAIN_STATUS_LABELS[status as keyof typeof DOMAIN_STATUS_LABELS] ?? status;
      case 'key':
        return status === 'active' ? 'Active' : 'Revoked';
      default:
        return ITEM_STATUS_LABELS[status as keyof typeof ITEM_STATUS_LABELS] ?? status;
    }
  });

  readonly tone = computed<Tone>(() => TONES[this.status()] ?? 'neutral');
}
