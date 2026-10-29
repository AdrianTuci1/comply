import {
  ComplianceStatus,
  ResourceCategory,
  UpdateTag,
} from '../../domain/trust/trust-center-content';
import { TrustCategory } from '../../domain/trust/trust-claim';

/** English copy for the public trust center. The admin app stays localized separately. */
export const TRUST_CATEGORY_LABELS: Record<TrustCategory, string> = {
  infrastructure: 'Infrastructure security',
  organizational: 'Organizational security',
  product: 'Product security',
  procedures: 'Internal procedures',
  data_privacy: 'Data and privacy',
};

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
