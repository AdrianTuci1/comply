import { Injectable } from '@angular/core';
import { AssessmentBoard } from '../../domain/compliance/assessment-board';
import { AssessmentBoardRepository } from '../../domain/compliance/assessment-board.repository';
import { BOARD_FIXTURES } from './fixtures/board.fixtures';

@Injectable()
export class InMemoryAssessmentBoardRepository extends AssessmentBoardRepository {
  private readonly store = new Map<string, AssessmentBoard>();

  constructor() {
    super();
    for (const fixture of BOARD_FIXTURES) {
      this.store.set(fixture.id, AssessmentBoard.restore(fixture));
    }
  }

  findAll(): readonly AssessmentBoard[] {
    return [...this.store.values()];
  }

  findById(id: string): AssessmentBoard | undefined {
    return this.store.get(id);
  }

  add(board: AssessmentBoard): void {
    this.store.set(board.id, board);
  }

  save(board: AssessmentBoard): void {
    this.store.set(board.id, board);
  }
}
