import { LocalStorageAssessmentBoardRepository } from './local-storage-assessment-board.repository';

describe('LocalStorageAssessmentBoardRepository', () => {
  beforeEach(() => localStorage.clear());

  it('restores boards and checklist changes in a new instance', () => {
    const repository = new LocalStorageAssessmentBoardRepository();
    const board = repository.findById('b-nis2-2026')!;

    repository.save(board.deactivate());

    const restored = new LocalStorageAssessmentBoardRepository();
    expect(restored.findAll().length).toBeGreaterThan(0);
    expect(restored.findById('b-nis2-2026')?.isActive).toBe(false);
  });
});
