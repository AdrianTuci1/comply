import { Injectable } from '@angular/core';
import { ContentLibraryRepository } from '../../domain/content/content-library.repository';
import {
  ContentRequirement,
  ContentRequirementSnapshot,
} from '../../domain/content/content-requirement';
import { ContentSource, ContentSourceSnapshot } from '../../domain/content/content-source';
import {
  CONTENT_REQUIREMENT_FIXTURES,
  CONTENT_SOURCE_FIXTURES,
} from '../in-memory/fixtures/content-library.fixtures';
import { apiUrl } from './api-url';

interface LibraryPayload {
  sources?: unknown[];
  requirements?: unknown[];
}

/**
 * Reads the managed requirement library from the backend pipeline. The app
 * initializer hydrates the cache before the first render, so the facade can stay
 * synchronous.
 */
@Injectable()
export class HttpContentLibraryRepository extends ContentLibraryRepository {
  private sources: ContentSource[] = [];
  private requirements: ContentRequirement[] = [];

  override async hydrate(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/library'), {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Library request failed with ${response.status}.`);

      const payload = (await response.json()) as LibraryPayload;
      this.sources = (payload.sources ?? []).map((item) =>
        ContentSource.restore(item as ContentSourceSnapshot),
      );
      this.requirements = (payload.requirements ?? []).map((item) =>
        ContentRequirement.restore(item as ContentRequirementSnapshot),
      );
    } catch (error) {
      console.warn(
        'Content library API is unavailable. Falling back to the local demonstration library.',
        error,
      );
      this.sources = CONTENT_SOURCE_FIXTURES.map((fixture) => ContentSource.restore(fixture));
      this.requirements = CONTENT_REQUIREMENT_FIXTURES.map((fixture) =>
        ContentRequirement.restore(fixture),
      );
    }
  }

  findSources(): readonly ContentSource[] {
    return [...this.sources];
  }

  findRequirements(): readonly ContentRequirement[] {
    return [...this.requirements];
  }
}
