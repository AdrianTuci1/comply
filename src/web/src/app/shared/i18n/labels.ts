import { DeploymentMode, DomainStatus, McpScope } from '../../domain/access/mcp-access';
import { BoardStatus } from '../../domain/compliance/assessment-board';
import { EvidenceReviewStatus, EvidenceType } from '../../domain/compliance/evidence-artifact';
import { FrameworkId, FRAMEWORK_CATALOG } from '../../domain/compliance/framework';
import { ContentStatus } from '../../domain/content/content-requirement';
import { SourceKind, SourceLicense } from '../../domain/content/content-source';
import { ItemStatus } from '../../domain/compliance/item-status';
import { OrganizationPlan } from '../../domain/organization/organization';
import { Role } from '../../domain/team/member';
import {
  ComplianceStatus,
  ResourceCategory,
  UpdateTag,
} from '../../domain/trust/trust-center-content';
import { ClaimVisibility, TrustCategory } from '../../domain/trust/trust-claim';

/** Presentation dictionary. Domain types stay language-neutral. */

export const FRAMEWORK_LABELS: Record<FrameworkId, string> = {
  nis2: FRAMEWORK_CATALOG.nis2.label,
  iso27001: FRAMEWORK_CATALOG.iso27001.label,
  'ai-act': FRAMEWORK_CATALOG['ai-act'].label,
};

export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  in_review: 'In review',
  complete: 'Complete',
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  proposed: 'Proposed',
  in_review: 'In review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  not_applicable: 'Not applicable',
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  document: 'Document',
  screenshot: 'Screenshot',
  log_export: 'Log export',
  api_report: 'API report',
  attestation: 'Attestation',
};

export const EVIDENCE_REVIEW_LABELS: Record<EvidenceReviewStatus, string> = {
  pending: 'In review',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  reviewer: 'Reviewer',
  contributor: 'Contributor',
  auditor: 'Auditor',
};

export const PLAN_LABELS: Record<OrganizationPlan, string> = {
  free: 'Free',
  team: 'Team',
  enterprise: 'Enterprise',
};

export const TRUST_CATEGORY_LABELS: Record<TrustCategory, string> = {
  infrastructure: 'Infrastructure security',
  organizational: 'Organizational security',
  product: 'Product security',
  procedures: 'Internal procedures',
  data_privacy: 'Data and privacy',
};

export const CLAIM_VISIBILITY_LABELS: Record<ClaimVisibility, string> = {
  public: 'Public',
  nda: 'Under NDA',
  private: 'Private',
};

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  documents: 'Documents',
  privacy: 'Privacy',
};

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  aligned: 'Aligned',
  in_progress: 'In progress',
  not_started: 'Not started',
};

export const UPDATE_TAG_LABELS: Record<UpdateTag, string> = {
  general: 'General',
  security: 'Security',
  subprocessors: 'Subprocessors',
  privacy: 'Privacy',
};

export const FRAMEWORK_MONOGRAMS: Record<FrameworkId, string> = {
  nis2: 'NIS2',
  iso27001: 'ISO',
  'ai-act': 'AI',
};

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
};

export const SOURCE_LICENSE_LABELS: Record<SourceLicense, string> = {
  public: 'Public',
  proprietary: 'Proprietary',
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  html: 'HTML',
  markdown: 'Markdown',
  text: 'Text',
};

export const DEPLOYMENT_MODE_LABELS: Record<DeploymentMode, string> = {
  managed: 'Managed',
  self_hosted: 'Self-hosted',
};

export const DOMAIN_STATUS_LABELS: Record<DomainStatus, string> = {
  unverified: 'Not connected',
  pending: 'Verifying',
  verified: 'Verified',
};

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  read: 'Read',
  'evidence:write': 'Submit evidence',
  admin: 'Admin',
};
