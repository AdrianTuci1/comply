import { DomainError } from '../../shared-kernel/domain-error';

export const ITEM_STATUSES = [
  'not_started',
  'in_progress',
  'proposed',
  'in_review',
  'accepted',
  'rejected',
  'not_applicable',
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type StaleReason = 'requirement_changed' | 'evidence_expired';

/**
 * State machine for checklist items. The table is the single source of truth
 * for legal moves; the UI and the aggregate both consult it.
 */
const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  not_started: ['in_progress', 'proposed', 'in_review', 'accepted', 'rejected', 'not_applicable'],
  in_progress: ['not_started', 'proposed', 'in_review', 'accepted', 'rejected', 'not_applicable'],
  proposed: ['in_progress', 'in_review', 'accepted', 'rejected', 'not_applicable'],
  in_review: ['in_progress', 'proposed', 'accepted', 'rejected', 'not_applicable'],
  accepted: ['in_review', 'rejected', 'not_applicable'],
  rejected: ['in_progress', 'proposed', 'in_review', 'accepted', 'not_applicable'],
  not_applicable: ['not_started', 'in_progress', 'proposed'],
};

export class ItemWorkflow {
  static canTransition(from: ItemStatus, to: ItemStatus): boolean {
    return from !== to && TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: ItemStatus, to: ItemStatus): void {
    if (!ItemWorkflow.canTransition(from, to)) {
      throw new DomainError(`The transition "${from}" → "${to}" is not allowed.`);
    }
  }

  static nextStatuses(from: ItemStatus): readonly ItemStatus[] {
    return TRANSITIONS[from];
  }
}
