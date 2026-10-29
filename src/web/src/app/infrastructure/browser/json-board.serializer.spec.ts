import { AssessmentBoard } from '../../domain/compliance/assessment-board';
import { JsonBoardSerializer } from './json-board.serializer';

const BOARD = AssessmentBoard.restore({
  id: 'b-1',
  organizationId: 'org-1',
  name: 'NIS2 — test',
  framework: 'nis2',
  frameworkVersion: 'OUG 155/2024',
  periodFrom: '2026-01-01',
  periodTo: '2026-12-31',
  status: 'in_progress',
  total: 84,
  accepted: 1,
  proposed: 0,
  gaps: 0,
  owner: 'Ana',
  updatedAt: '2026-09-30T10:00:00Z',
  items: [
    {
      id: 'i-1',
      ref: '21(2)(a)',
      title: 'Politici',
      status: 'accepted',
      evidenceCount: 2,
      owner: 'Ana',
      updatedAt: '2026-09-30T10:00:00Z',
    },
  ],
});

describe('JsonBoardSerializer', () => {
  const serializer = new JsonBoardSerializer();

  it('round-trips a board through the portable format', () => {
    const result = serializer.deserialize(serializer.serialize(BOARD));

    expect(result.isSuccess).toBe(true);
    expect(result.value.name).toBe('NIS2 — test');
    expect(result.value.items.length).toBe(1);
    expect(result.value.itemById('i-1')?.status).toBe('accepted');
  });

  it('rejects files that are not Comply boards', () => {
    const result = serializer.deserialize('{"format":"other"}');

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('not a Comply board');
  });

  it('rejects malformed JSON with an explicit message', () => {
    const result = serializer.deserialize('not json');

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('does not contain valid JSON');
  });

  it('rejects unsupported file versions', () => {
    const result = serializer.deserialize(
      JSON.stringify({ format: 'comply.board', version: 2, board: {} }),
    );

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('is not supported');
  });
});
