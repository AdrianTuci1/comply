import { Injectable } from '@angular/core';
import {
  SourceDocument,
  SourceDocumentGateway,
  SourceDocumentMeta,
} from '../../application/ports/source-document.gateway';

@Injectable()
export class HttpSourceDocumentGateway extends SourceDocumentGateway {
  async list(): Promise<readonly SourceDocumentMeta[]> {
    const response = await fetch('/api/documents', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Documents request failed with ${response.status}.`);
    const payload = (await response.json()) as { documents?: SourceDocumentMeta[] };
    return payload.documents ?? [];
  }

  async get(id: string): Promise<SourceDocument> {
    const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Document request failed with ${response.status}.`);
    const payload = (await response.json()) as { document?: SourceDocument };
    if (!payload.document) throw new Error('Document is missing from the response.');
    return payload.document;
  }
}
