import { Injectable } from '@angular/core';
import { BoardSerializer } from '../../application/ports/board-serializer';
import { AssessmentBoard, AssessmentBoardSnapshot } from '../../domain/compliance/assessment-board';
import { isFrameworkId } from '../../domain/compliance/framework';
import { Result } from '../../shared-kernel/result';

const FORMAT = 'comply.board';
const FORMAT_VERSION = 1;

interface BoardFileV1 {
  format: typeof FORMAT;
  version: typeof FORMAT_VERSION;
  exportedAt: string;
  board: AssessmentBoardSnapshot;
}

/**
 * Adapter that keeps the file format documented in one place.
 * Import errors travel as Result values so the UI never needs try/catch.
 */
@Injectable()
export class JsonBoardSerializer extends BoardSerializer {
  serialize(board: AssessmentBoard): string {
    const payload: BoardFileV1 = {
      format: FORMAT,
      version: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      board: board.toSnapshot(),
    };
    return JSON.stringify(payload, null, 2);
  }

  deserialize(text: string): Result<AssessmentBoard> {
    let parsed: Partial<BoardFileV1>;
    try {
      parsed = JSON.parse(text) as Partial<BoardFileV1>;
    } catch {
      return Result.fail('The file does not contain valid JSON.');
    }

    if (parsed.format !== FORMAT) {
      return Result.fail('The file is not a Comply board.');
    }
    if (parsed.version !== FORMAT_VERSION) {
      return Result.fail(`File version "${parsed.version}" is not supported.`);
    }

    const board = parsed.board;
    if (!board || typeof board.id !== 'string' || !Array.isArray(board.items)) {
      return Result.fail('The file does not contain a complete board.');
    }
    if (!isFrameworkId(board.framework)) {
      return Result.fail('The board framework is not recognized.');
    }

    try {
      return Result.ok(AssessmentBoard.restore(board));
    } catch (error) {
      return Result.fail(
        error instanceof Error ? error.message : 'The board in the file is invalid.',
      );
    }
  }
}
