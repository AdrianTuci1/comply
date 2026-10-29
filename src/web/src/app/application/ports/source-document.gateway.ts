import { FrameworkId } from '../../domain/compliance/framework';

export interface SourceDocumentMeta {
  id: string;
  sourceId: string;
  frameworkId: FrameworkId;
  title: string;
  url: string;
  officialUrl?: string;
  publisher?: string;
  license?: string;
  fetchedAt: string;
  sha256: string;
  bytes: number;
}

export interface SourceDocumentPage {
  ref: string;
  title: string;
  url: string;
  text: string;
}

export interface SourceDocument extends SourceDocumentMeta {
  pages: readonly SourceDocumentPage[];
}

/** Port: the documents captured by the backend ingestion pipeline. */
export abstract class SourceDocumentGateway {
  abstract list(): Promise<readonly SourceDocumentMeta[]>;
  abstract get(id: string): Promise<SourceDocument>;
}
