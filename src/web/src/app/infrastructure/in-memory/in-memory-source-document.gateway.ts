import { Injectable } from '@angular/core';
import {
  SourceDocument,
  SourceDocumentGateway,
  SourceDocumentMeta,
} from '../../application/ports/source-document.gateway';

/** Test adapter: the demonstration fixtures ship without captured documents. */
@Injectable()
export class InMemorySourceDocumentGateway extends SourceDocumentGateway {
  async list(): Promise<readonly SourceDocumentMeta[]> {
    return [];
  }

  async get(id: string): Promise<SourceDocument> {
    throw new Error(`Document ${id} is not available in memory.`);
  }
}
