import { Injectable, inject, signal } from '@angular/core';
import { ContentLibraryRepository } from '../domain/content/content-library.repository';
import { ContentRequirement } from '../domain/content/content-requirement';
import { ContentSource } from '../domain/content/content-source';

/**
 * Read model for the managed requirement library. Comply publishes sources and
 * requirements through the ingest pipeline; the interface only reads them.
 */
@Injectable({ providedIn: 'root' })
export class ContentLibraryFacade {
  private readonly repository = inject(ContentLibraryRepository);

  private readonly sourcesState = signal<readonly ContentSource[]>(this.repository.findSources());
  private readonly requirementsState = signal<readonly ContentRequirement[]>(
    this.repository.findRequirements(),
  );

  readonly sources = this.sourcesState.asReadonly();
  readonly requirements = this.requirementsState.asReadonly();

  /** Re-reads the remote library after the ingest pipeline saved new documents. */
  async reload(): Promise<void> {
    await this.repository.hydrate?.();
    this.sourcesState.set(this.repository.findSources());
    this.requirementsState.set(this.repository.findRequirements());
  }

  sourceById(id: string): ContentSource | undefined {
    return this.sourcesState().find((source) => source.id === id);
  }

  requirementsOf(sourceId: string): readonly ContentRequirement[] {
    return this.requirementsState().filter((requirement) => requirement.sourceId === sourceId);
  }
}
