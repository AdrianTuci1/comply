import {
  EvidenceArtifactSnapshot,
  EvidenceType,
} from '../../../domain/compliance/evidence-artifact';
import { BOARD_FIXTURES } from './board.fixtures';

interface Variant {
  type: EvidenceType;
  title: string;
  source: string;
  body: (itemTitle: string, ref: string) => string;
}

const VARIANTS: readonly Variant[] = [
  {
    type: 'document',
    title: 'Approved policy',
    source: 'Manual upload',
    body: (itemTitle, ref) =>
      `${itemTitle} (${ref})\n\nPurpose\n\nThe document describes responsibilities, approvals, and the review cadence for the assessed requirement.\n\nApplication\n\nThe policy is shared with the team at onboarding and reviewed annually by management. Exceptions are approved by the security lead.\n\nApproval\n\nThe current version is signed by the general manager and the security lead.`,
  },
  {
    type: 'log_export',
    title: 'Configuration export',
    source: 'Azure Policy',
    body: (itemTitle, ref) =>
      `${itemTitle} (${ref})\n\nSource\n\nAutomatic export of the policies applied in the production subscription.\n\nResult\n\nAll resources in scope comply with the mandatory policies. Two documented exceptions have a remediation deadline next quarter.\n\nVerification\n\nThe export is generated weekly and stored with a hash for traceability.`,
  },
  {
    type: 'screenshot',
    title: 'Console screenshot',
    source: 'Entra ID',
    body: (itemTitle, ref) =>
      `${itemTitle} (${ref})\n\nWhat the screenshot shows\n\nAuthentication settings and the list of members with administrative access at collection time.\n\nObservations\n\nMulti-factor authentication is mandatory for every administrative account. No accounts are without an owner.\n\nLimitations\n\nThe screenshot reflects the state at collection time, not the full change history.`,
  },
  {
    type: 'api_report',
    title: 'Scan report',
    source: 'GitHub Advanced Security',
    body: (itemTitle, ref) =>
      `${itemTitle} (${ref})\n\nScope\n\nScan of the repositories that deliver the service to customers.\n\nFindings\n\nNo critical or high vulnerabilities were found in the current version. Dependencies are updated automatically.\n\nRemediation\n\nMedium findings have a 30-day deadline and are tracked on the board.`,
  },
  {
    type: 'attestation',
    title: 'Management attestation',
    source: 'Manual upload',
    body: (itemTitle, ref) =>
      `${itemTitle} (${ref})\n\nStatement\n\nManagement confirms that the described measures are implemented and that the attached evidence reflects the actual state.\n\nPeriod\n\nThe statement covers the current assessment cycle.\n\nSignatures\n\nGeneral manager and security lead.`,
  },
];

/** Demo artifacts generated for every checklist item that declares evidence. */
export const EVIDENCE_ARTIFACT_FIXTURES: EvidenceArtifactSnapshot[] = BOARD_FIXTURES.flatMap(
  (board) =>
    board.items.flatMap((item) =>
      Array.from({ length: item.evidenceCount }, (_, index) => {
        const variant = VARIANTS[index % VARIANTS.length];
        return {
          id: `ev-${board.id}-${item.id}-${index + 1}`,
          organizationId: board.organizationId,
          boardId: board.id,
          itemId: item.id,
          title: `${variant.title} — ${item.ref}`,
          type: variant.type,
          source: variant.source,
          collectedAt: item.updatedAt.slice(0, 10),
          submittedBy: item.owner,
          hash: `sha256:${digest(`${board.id}:${item.id}:${index}`)}`,
          reviewStatus: 'accepted' as const,
          body: variant.body(item.title, item.ref),
        };
      }),
    ),
);

function digest(seed: string): string {
  let state = 2166136261;
  const blocks: string[] = [];
  for (let block = 0; block < 8; block += 1) {
    for (const char of `${seed}:${block}`) {
      state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    }
    blocks.push(state.toString(16).padStart(8, '0'));
  }
  return blocks.join('');
}
