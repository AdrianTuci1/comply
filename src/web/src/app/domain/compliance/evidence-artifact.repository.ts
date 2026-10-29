import { EvidenceArtifact } from './evidence-artifact';

export abstract class EvidenceArtifactRepository {
  abstract findAll(): readonly EvidenceArtifact[];
  abstract findByItem(boardId: string, itemId: string): readonly EvidenceArtifact[];
}
