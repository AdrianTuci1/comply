import { DomainError } from '../../shared-kernel/domain-error';
import { AssessmentBoard, AssessmentBoardSnapshot } from './assessment-board';
import { AssessmentPeriod } from './assessment-period';

const NOW = new Date('2026-10-01T10:00:00Z');

function snapshot(overrides: Partial<AssessmentBoardSnapshot> = {}): AssessmentBoardSnapshot {
  return {
    id: 'b-1',
    organizationId: 'org-1',
    name: 'NIS2 — test',
    framework: 'nis2',
    frameworkVersion: 'OUG 155/2024',
    periodFrom: '2026-01-01',
    periodTo: '2026-12-31',
    status: 'in_progress',
    total: 10,
    accepted: 5,
    proposed: 2,
    gaps: 3,
    owner: 'Ana',
    updatedAt: '2026-09-30T10:00:00Z',
    items: [
      {
        id: 'i-1',
        ref: '21(2)(a)',
        title: 'Security policies',
        status: 'proposed',
        evidenceCount: 2,
        owner: 'Ana',
        updatedAt: '2026-09-30T10:00:00Z',
      },
      {
        id: 'i-2',
        ref: '21(2)(b)',
        title: 'No evidence',
        status: 'in_review',
        evidenceCount: 0,
        owner: 'Vlad',
        updatedAt: '2026-09-30T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

describe('AssessmentBoard (aggregate)', () => {
  it('creates a draft with the requirement count of the framework', () => {
    const board = AssessmentBoard.create({
      id: 'b-new',
      organizationId: 'org-1',
      name: 'New board',
      framework: 'iso27001',
      period: AssessmentPeriod.forYear(2027),
      owner: 'Ana',
      now: NOW,
    });

    expect(board.status).toBe('draft');
    expect(board.total).toBe(93);
    expect(board.coverage).toBe(0);
    expect(board.updatedAt).toBe(NOW.toISOString());
  });

  it('seeds the checklist from the library with titles and descriptions', () => {
    const board = AssessmentBoard.create({
      id: 'b-new',
      organizationId: 'org-1',
      name: 'NIS2 — library board',
      framework: 'nis2',
      period: AssessmentPeriod.forYear(2027),
      owner: 'Ana',
      requirements: [
        {
          ref: 'Art. 21(2)(a)',
          title: 'Risk analysis policies',
          description: 'The organization approves and reviews risk analysis policies.',
        },
        {
          ref: 'Art. 21(2)(b)',
          title: 'Incident management',
          description: 'A documented process detects and responds to incidents.',
        },
      ],
      now: NOW,
    });

    expect(board.total).toBe(2);
    expect(board.items.map((item) => item.ref)).toEqual(['Art. 21(2)(a)', 'Art. 21(2)(b)']);
    expect(board.items[0].title).toBe('Risk analysis policies');
    expect(board.items[0].description).toBe(
      'The organization approves and reviews risk analysis policies.',
    );
  });

  it('rejects names that are too short', () => {
    expect(() =>
      AssessmentBoard.create({
        id: 'b-new',
        organizationId: 'org-1',
        name: 'ab',
        framework: 'nis2',
        period: AssessmentPeriod.forYear(2027),
        owner: 'Ana',
      }),
    ).toThrow(DomainError);
  });

  it('projects a status change onto coverage and gap counters', () => {
    const board = AssessmentBoard.restore(snapshot());
    const updated = board.changeItemStatus('i-1', 'accepted', NOW);

    expect(updated.accepted).toBe(6);
    expect(updated.proposed).toBe(1);
    expect(updated.gaps).toBe(2);
    expect(updated.coverage).toBe(60);
    expect(updated.status).toBe('in_progress');
  });

  it('refuses acceptance without evidence', () => {
    const board = AssessmentBoard.restore(snapshot());

    expect(() => board.changeItemStatus('i-2', 'accepted', NOW)).toThrow(
      'without at least one piece of evidence',
    );
  });

  it('enforces the item state machine', () => {
    const board = AssessmentBoard.restore(
      snapshot({
        items: [
          {
            id: 'i-1',
            ref: '21(2)(a)',
            title: 'Policies',
            status: 'not_applicable',
            evidenceCount: 1,
            owner: 'Ana',
            updatedAt: NOW.toISOString(),
          },
        ],
      }),
    );

    expect(() => board.changeItemStatus('i-1', 'accepted', NOW)).toThrow('is not allowed');
    expect(board.changeItemStatus('i-1', 'in_progress', NOW).itemById('i-1')?.status).toBe(
      'in_progress',
    );
  });

  it('sends only eligible boards to review', () => {
    const board = AssessmentBoard.restore(snapshot({ status: 'draft' }));
    const inReview = board.sendToReview(NOW);

    expect(inReview.status).toBe('in_review');
    expect(() => inReview.sendToReview(NOW)).toThrow(DomainError);
  });

  it('imports a copy with fresh identity for another organization', () => {
    const source = AssessmentBoard.restore(snapshot());
    const copy = AssessmentBoard.importCopy(source.toSnapshot(), {
      id: 'b-imported',
      organizationId: 'org-2',
      now: NOW,
    });

    expect(copy.id).toBe('b-imported');
    expect(copy.organizationId).toBe('org-2');
    expect(copy.name).toBe('NIS2 — test (import)');
    expect(copy.items.map((item) => item.id)).toEqual(['b-imported-0', 'b-imported-1']);
    expect(copy.accepted).toBe(source.accepted);
  });
});
