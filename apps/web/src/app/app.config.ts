import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { AgentGateway } from './application/ports/agent-gateway';
import { ContentIngestGateway } from './application/ports/content-ingest.gateway';
import { McpKeyGateway } from './application/ports/mcp-key.gateway';
import { SourceDocumentGateway } from './application/ports/source-document.gateway';
import { AssessmentBoardRepository } from './domain/compliance/assessment-board.repository';
import { ContentLibraryRepository } from './domain/content/content-library.repository';
import { LocalStorageAssessmentBoardRepository } from './infrastructure/browser/local-storage-assessment-board.repository';
import { HttpAgentGateway } from './infrastructure/http/http-agent.gateway';
import { HttpMcpKeyGateway } from './infrastructure/http/http-mcp-key.gateway';
import { HttpContentIngestGateway } from './infrastructure/http/http-content-ingest.gateway';
import { HttpContentLibraryRepository } from './infrastructure/http/http-content-library.repository';
import { HttpSourceDocumentGateway } from './infrastructure/http/http-source-document.gateway';
import { APP_PROVIDERS } from './app.providers';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    ...APP_PROVIDERS,
    { provide: AssessmentBoardRepository, useClass: LocalStorageAssessmentBoardRepository },
    { provide: ContentLibraryRepository, useClass: HttpContentLibraryRepository },
    { provide: SourceDocumentGateway, useClass: HttpSourceDocumentGateway },
    { provide: ContentIngestGateway, useClass: HttpContentIngestGateway },
    { provide: AgentGateway, useClass: HttpAgentGateway },
    { provide: McpKeyGateway, useClass: HttpMcpKeyGateway },
    provideAppInitializer(() => inject(ContentLibraryRepository).hydrate?.() ?? Promise.resolve()),
  ],
};
