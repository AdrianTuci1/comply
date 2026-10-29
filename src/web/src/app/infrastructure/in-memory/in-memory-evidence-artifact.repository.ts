import { EvidenceArtifact } from '../../domain/compliance/evidence-artifact';
import { EvidenceArtifactRepository } from '../../domain/compliance/evidence-artifact.repository';
import { EVIDENCE_ARTIFACT_FIXTURES } from './fixtures/evidence-artifact.fixtures';

export class InMemoryEvidenceArtifactRepository implements EvidenceArtifactRepository {
  private readonly store = new Map<string, EvidenceArtifact>(
    EVIDENCE_ARTIFACT_FIXTURES.map((snapshot) => {
      const artifact = EvidenceArtifact.restore(snapshot);
      return [artifact.id, artifact];
    }),
  );

  findAll(): readonly EvidenceArtifact[] {
    return [...this.store.values()];
  }

  findByItem(boardId: string, itemId: string): readonly EvidenceArtifact[] {
    return [...this.store.values()].filter(
      (artifact) => artifact.boardId === boardId && artifact.itemId === itemId,
    );
  }
}
