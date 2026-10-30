import {
  ComplianceStatus,
  ResourceCategory,
  UpdateTag,
} from '../../domain/trust/trust-center-content';
import { DEFAULT_TRUST_CATEGORY_LABELS } from '../../shared/i18n/trust-category-labels';

/** English copy for the public trust center. The admin app stays localized separately. */
export const TRUST_CATEGORY_LABELS = DEFAULT_TRUST_CATEGORY_LABELS;

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  documents: 'Documents',
  privacy: 'Privacy',
};

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  aligned: 'Aligned (declared)',
  in_progress: 'In preparation',
  not_started: 'Not started',
};

export const UPDATE_TAG_LABELS: Record<UpdateTag, string> = {
  general: 'General',
  security: 'Security',
  subprocessors: 'Subprocessors',
  privacy: 'Privacy',
};

export const TRUST_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'resources', label: 'Resources' },
  { key: 'controls', label: 'Controls' },
  { key: 'subprocessors', label: 'Subprocessors' },
  { key: 'updates', label: 'Updates' },
] as const;

export type TrustTab = (typeof TRUST_TABS)[number]['key'];
