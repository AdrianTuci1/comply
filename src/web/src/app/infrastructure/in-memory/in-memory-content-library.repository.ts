import { Injectable } from '@angular/core';
import { ContentLibraryRepository } from '../../domain/content/content-library.repository';
import { ContentRequirement } from '../../domain/content/content-requirement';
import { ContentSource } from '../../domain/content/content-source';
import {
  CONTENT_REQUIREMENT_FIXTURES,
  CONTENT_SOURCE_FIXTURES,
} from './fixtures/content-library.fixtures';

@Injectable()
export class InMemoryContentLibraryRepository extends ContentLibraryRepository {
  private readonly sources = CONTENT_SOURCE_FIXTURES.map((fixture) =>
    ContentSource.restore(fixture),
  );
  private readonly requirements = CONTENT_REQUIREMENT_FIXTURES.map((fixture) =>
    ContentRequirement.restore(fixture),
  );

  findSources(): readonly ContentSource[] {
    return [...this.sources];
  }

  findRequirements(): readonly ContentRequirement[] {
    return [...this.requirements];
  }
}
