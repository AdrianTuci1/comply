import { Injectable } from '@angular/core';
import { AssessmentBoard, AssessmentBoardSnapshot } from '../../domain/compliance/assessment-board';
import { AssessmentBoardRepository } from '../../domain/compliance/assessment-board.repository';
import { BOARD_FIXTURES } from '../in-memory/fixtures/board.fixtures';

const STORAGE_KEY = 'comply.boards.v1';

interface BoardStorage {
  version: number;
  boards: AssessmentBoardSnapshot[];
}

/**
 * Keeps boards and their checklist changes in the browser so a refresh does not
 * discard work. The in-memory adapter stays the default for tests.
 */
@Injectable()
export class LocalStorageAssessmentBoardRepository extends AssessmentBoardRepository {
  private readonly store = new Map<string, AssessmentBoard>();

  constructor() {
    super();
    const saved = this.read();
    const snapshots = saved ?? BOARD_FIXTURES;
    for (const snapshot of snapshots) {
      try {
        const board = AssessmentBoard.restore(snapshot);
        this.store.set(board.id, board);
      } catch {
        // Ignore an entry that no longer matches the domain model.
      }
    }
    if (!saved) this.persist();
  }

  findAll(): readonly AssessmentBoard[] {
    return [...this.store.values()];
  }

  findById(id: string): AssessmentBoard | undefined {
    return this.store.get(id);
  }

  add(board: AssessmentBoard): void {
    this.store.set(board.id, board);
    this.persist();
  }

  save(board: AssessmentBoard): void {
    this.store.set(board.id, board);
    this.persist();
  }

  private read(): AssessmentBoardSnapshot[] | null {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as BoardStorage;
      return Array.isArray(parsed.boards) ? parsed.boards : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      const payload: BoardStorage = {
        version: 1,
        boards: [...this.store.values()].map((board) => board.toSnapshot()),
      };
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable (private mode or quota); the session still works.
    }
  }
}
