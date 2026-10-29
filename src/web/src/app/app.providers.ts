import { Provider } from '@angular/core';
import { ActiveOrganizationStorage } from './application/ports/active-organization.storage';
import { AgentGateway } from './application/ports/agent-gateway';
import { AuthGateway } from './application/ports/auth.gateway';
import { McpKeyGateway } from './application/ports/mcp-key.gateway';
import { BoardSerializer } from './application/ports/board-serializer';
import { SourceDocumentGateway } from './application/ports/source-document.gateway';
import { FileDownloader } from './application/ports/file-downloader';
import { FileTextReader } from './application/ports/file-text-reader';
import { McpAccessRepository } from './domain/access/mcp-access.repository';
import { AssessmentBoardRepository } from './domain/compliance/assessment-board.repository';
import { EvidenceArtifactRepository } from './domain/compliance/evidence-artifact.repository';
import { ContentIngestGateway } from './application/ports/content-ingest.gateway';
import { ContentLibraryRepository } from './domain/content/content-library.repository';
import { OrganizationRepository } from './domain/organization/organization.repository';
import { MemberRepository } from './domain/team/member.repository';
import { TrustCenterContentRepository } from './domain/trust/trust-center-content.repository';
import { TrustClaimRepository } from './domain/trust/trust-claim.repository';
import { BrowserFileDownloader } from './infrastructure/browser/browser-file-downloader';
import { HttpAuthGateway } from './infrastructure/http/http-auth.gateway';
import { InMemorySourceDocumentGateway } from './infrastructure/in-memory/in-memory-source-document.gateway';
import { BrowserFileTextReader } from './infrastructure/browser/browser-file-text-reader';
import { JsonBoardSerializer } from './infrastructure/browser/json-board.serializer';
import { LocalStorageActiveOrganizationStorage } from './infrastructure/browser/local-storage-active-organization.storage';
import { InMemoryAgentGateway } from './infrastructure/in-memory/in-memory-agent.gateway';
import { InMemoryAssessmentBoardRepository } from './infrastructure/in-memory/in-memory-assessment-board.repository';
import { InMemoryContentIngestGateway } from './infrastructure/in-memory/in-memory-content-ingest.gateway';
import { InMemoryContentLibraryRepository } from './infrastructure/in-memory/in-memory-content-library.repository';
import { InMemoryEvidenceArtifactRepository } from './infrastructure/in-memory/in-memory-evidence-artifact.repository';
import { InMemoryMcpAccessRepository } from './infrastructure/in-memory/in-memory-mcp-access.repository';
import { InMemoryMcpKeyGateway } from './infrastructure/in-memory/in-memory-mcp-key.gateway';
import { InMemoryMemberRepository } from './infrastructure/in-memory/in-memory-member.repository';
import { InMemoryOrganizationRepository } from './infrastructure/in-memory/in-memory-organization.repository';
import { InMemoryTrustCenterContentRepository } from './infrastructure/in-memory/in-memory-trust-center-content.repository';
import { InMemoryTrustClaimRepository } from './infrastructure/in-memory/in-memory-trust-claim.repository';

/**
 * Composition root: binds ports to adapters.
 * Swapping an in-memory adapter for HTTP or IndexedDB is a one-line change here.
 */
export const APP_PROVIDERS: Provider[] = [
  { provide: OrganizationRepository, useClass: InMemoryOrganizationRepository },
  { provide: MemberRepository, useClass: InMemoryMemberRepository },
  { provide: AssessmentBoardRepository, useClass: InMemoryAssessmentBoardRepository },
  { provide: EvidenceArtifactRepository, useClass: InMemoryEvidenceArtifactRepository },
  { provide: ContentLibraryRepository, useClass: InMemoryContentLibraryRepository },
  { provide: McpAccessRepository, useClass: InMemoryMcpAccessRepository },
  { provide: TrustClaimRepository, useClass: InMemoryTrustClaimRepository },
  { provide: TrustCenterContentRepository, useClass: InMemoryTrustCenterContentRepository },
  { provide: BoardSerializer, useClass: JsonBoardSerializer },
  { provide: FileDownloader, useClass: BrowserFileDownloader },
  { provide: FileTextReader, useClass: BrowserFileTextReader },
  { provide: ActiveOrganizationStorage, useClass: LocalStorageActiveOrganizationStorage },
  { provide: AuthGateway, useClass: HttpAuthGateway },
  { provide: SourceDocumentGateway, useClass: InMemorySourceDocumentGateway },
  { provide: ContentIngestGateway, useClass: InMemoryContentIngestGateway },
  { provide: AgentGateway, useClass: InMemoryAgentGateway },
  { provide: McpKeyGateway, useClass: InMemoryMcpKeyGateway },
];
