import { ContentRequirement } from './content-requirement';
import { ContentSource } from './content-source';

/**
 * Port: read-only access to the managed source documents and extracted
 * requirements. Comply owns the content; clients only read it.
 */
export abstract class ContentLibraryRepository {
  /** Loads the remote library before the first render. In-memory adapters skip it. */
  hydrate?(): Promise<void>;

  abstract findSources(): readonly ContentSource[];
  abstract findRequirements(): readonly ContentRequirement[];
}
