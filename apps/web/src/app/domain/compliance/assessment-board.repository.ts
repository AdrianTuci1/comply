import { AssessmentBoard } from './assessment-board';

/** Port: persistence boundary for assessment boards. */
export abstract class AssessmentBoardRepository {
  abstract findAll(): readonly AssessmentBoard[];
  abstract findById(id: string): AssessmentBoard | undefined;
  abstract add(board: AssessmentBoard): void;
  abstract save(board: AssessmentBoard): void;
}
