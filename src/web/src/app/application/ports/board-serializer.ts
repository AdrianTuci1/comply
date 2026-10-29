import { AssessmentBoard } from '../../domain/compliance/assessment-board';
import { Result } from '../../shared-kernel/result';

/** Port: converts an assessment board to and from the portable file format. */
export abstract class BoardSerializer {
  abstract serialize(board: AssessmentBoard): string;
  abstract deserialize(text: string): Result<AssessmentBoard>;
}
