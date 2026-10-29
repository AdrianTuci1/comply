import { Injectable, inject, signal } from '@angular/core';
import {
  AssessmentBoard,
  BoardRequirementSeed,
} from '../domain/compliance/assessment-board';
import { AssessmentPeriod } from '../domain/compliance/assessment-period';
import { AssessmentBoardRepository } from '../domain/compliance/assessment-board.repository';
import { EvidenceArtifact } from '../domain/compliance/evidence-artifact';
import { EvidenceArtifactRepository } from '../domain/compliance/evidence-artifact.repository';
import { FrameworkId } from '../domain/compliance/framework';
import { ItemStatus } from '../domain/compliance/item-status';
import { Result } from '../shared-kernel/result';
import { BoardSerializer } from './ports/board-serializer';
import { FileDownloader } from './ports/file-downloader';
import { FileTextReader } from './ports/file-text-reader';

export interface CreateBoardCommand {
  organizationId: string;
  name: string;
  framework: FrameworkId;
  from: string;
  to: string;
  owner: string;
  requirements?: readonly BoardRequirementSeed[];
}

/**
 * Use cases of the compliance context. Components call these methods and read
 * the signal-based read model; domain errors come back as Result values.
 */
@Injectable({ providedIn: 'root' })
export class ComplianceFacade {
  private readonly repository = inject(AssessmentBoardRepository);
  private readonly evidence = inject(EvidenceArtifactRepository);
  private readonly serializer = inject(BoardSerializer);
  private readonly downloader = inject(FileDownloader);
  private readonly reader = inject(FileTextReader);

  private readonly boardsState = signal<readonly AssessmentBoard[]>(this.repository.findAll());

  readonly boards = this.boardsState.asReadonly();

  boardsOf(organizationId: string): readonly AssessmentBoard[] {
    return this.boardsState().filter((board) => board.organizationId === organizationId);
  }

  boardById(id: string): AssessmentBoard | undefined {
    return this.boardsState().find((board) => board.id === id);
  }

  evidenceFor(boardId: string, itemId: string): readonly EvidenceArtifact[] {
    return this.evidence.findByItem(boardId, itemId);
  }

  createBoard(command: CreateBoardCommand): Result<AssessmentBoard> {
    try {
      const board = AssessmentBoard.create({
        id: this.nextId('b', command.organizationId),
        organizationId: command.organizationId,
        name: command.name,
        framework: command.framework,
        period: AssessmentPeriod.create(command.from, command.to),
        owner: command.owner,
        requirements: command.requirements,
      });
      this.repository.add(board);
      this.boardsState.update((boards) => [board, ...boards]);
      return Result.ok(board);
    } catch (error) {
      return this.failure(error, 'The assessment board could not be created.');
    }
  }

  changeItemStatus(boardId: string, itemId: string, status: ItemStatus): Result<AssessmentBoard> {
    return this.update(boardId, (board) => board.changeItemStatus(itemId, status));
  }

  saveConclusion(boardId: string, itemId: string, conclusion: string): Result<AssessmentBoard> {
    return this.update(boardId, (board) => board.saveConclusion(itemId, conclusion));
  }

  sendToReview(boardId: string): Result<AssessmentBoard> {
    return this.update(boardId, (board) => board.sendToReview());
  }

  deactivateBoard(boardId: string): Result<AssessmentBoard> {
    return this.update(boardId, (board) => board.deactivate());
  }

  reactivateBoard(boardId: string): Result<AssessmentBoard> {
    return this.update(boardId, (board) => board.reactivate());
  }

  exportBoard(board: AssessmentBoard): void {
    const filename = `${board.framework.id}-${board.period.fromYear}-${board.id}.json`;
    this.downloader.save(filename, this.serializer.serialize(board), 'application/json');
  }

  async importBoard(file: File, organizationId: string): Promise<Result<AssessmentBoard>> {
    let text: string;
    try {
      text = await this.reader.read(file);
    } catch (error) {
      return this.failure(error, 'The file could not be read.');
    }

    const decoded = this.serializer.deserialize(text);
    if (decoded.isFailure) {
      return Result.fail(decoded.error!);
    }

    try {
      const board = AssessmentBoard.importCopy(decoded.value.toSnapshot(), {
        id: this.nextId('b', organizationId),
        organizationId,
      });
      this.repository.add(board);
      this.boardsState.update((boards) => [board, ...boards]);
      return Result.ok(board);
    } catch (error) {
      return this.failure(error, 'The imported assessment board is invalid.');
    }
  }

  private update(
    boardId: string,
    action: (board: AssessmentBoard) => AssessmentBoard,
  ): Result<AssessmentBoard> {
    const board = this.boardById(boardId);
    if (!board) {
      return Result.fail('The assessment board was not found.');
    }

    try {
      const updated = action(board);
      this.repository.save(updated);
      this.boardsState.update((boards) =>
        boards.map((current) => (current.id === updated.id ? updated : current)),
      );
      return Result.ok(updated);
    } catch (error) {
      return this.failure(error, 'The operation could not be applied.');
    }
  }

  private nextId(prefix: string, organizationId: string): string {
    return `${prefix}-${organizationId}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
  }

  private failure(error: unknown, fallback: string): Result<never> {
    return Result.fail(error instanceof Error ? error.message : fallback);
  }
}
