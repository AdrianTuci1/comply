import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_PROVIDERS } from '../../../app.providers';
import { AgentAssessment, AgentGateway } from '../../../application/ports/agent-gateway';
import { AgentBoardDetail } from './agent-board-detail';

const DETAIL: AgentAssessment = {
  assessment_id: 'asm-1',
  name: 'NIS2 assessment',
  framework: 'nis2',
  status: 'collect',
  phase: 'collect',
  scope: 'Production subscription.',
  period: { from: '2026-01-01', to: '2026-12-31' },
  revision: 3,
  updated_at: '2026-10-29T10:00:00.000Z',
  content_status: 'published',
  language: 'en',
  events: [
    {
      at: '2026-10-29T10:00:00.000Z',
      revision: 3,
      type: 'evidence_submitted',
      message: 'Art. 21(2)(a): evidence submitted.',
    },
  ],
  items: [
    {
      requirement_id: 'req-1',
      ref: 'Art. 21(2)(a)',
      title: 'Risk analysis policies',
      description: 'Approve and review risk analysis policies.',
      status: 'completed',
      evidence_count: 1,
      conclusion: 'The policy is approved and reviewed annually.',
      completed_at: '2026-10-29T10:00:00.000Z',
      evidence: [
        {
          id: 'ev-1',
          title: 'Access control policy',
          type: 'document',
          source: 'SharePoint',
          summary: 'The approved policy covers all production systems.',
          citation: 'https://sharepoint.example/policy',
          collectedAt: '2026-10-29T10:00:00.000Z',
          hash: `sha256:${'a'.repeat(64)}`,
        },
      ],
    },
    {
      requirement_id: 'req-2',
      ref: 'Art. 21(2)(b)',
      title: 'Incident management',
      description: 'Detect, report, and respond to incidents.',
      status: 'open',
      evidence_count: 0,
      conclusion: null,
      completed_at: null,
      evidence: [],
    },
  ],
  total: 2,
  progress: {
    total: 2,
    completed: 1,
    not_applicable: 0,
    evidence_collected: 0,
    open: 1,
    evidence: 1,
    percent: 50,
  },
  next_actions: [
    {
      tool: 'get_requirement',
      description: 'Open the next requirement.',
      arguments: { assessmentId: 'asm-1', requirementId: 'req-2' },
    },
  ],
  language_policy: {
    userLanguage: 'any',
    publishLanguage: 'en',
    instruction: 'Reply in the user language and publish in English.',
  },
};

class FakeAgentGateway extends AgentGateway {
  override async list(): Promise<readonly never[]> {
    return [];
  }

  override async get(): Promise<AgentAssessment> {
    return DETAIL;
  }
}

describe('AgentBoardDetail', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentBoardDetail],
      providers: [
        provideRouter([]),
        ...APP_PROVIDERS,
        { provide: AgentGateway, useClass: FakeAgentGateway },
      ],
    }).compileComponents();
  });

  it('shows agent evidence, conclusions, and the next step', async () => {
    const fixture = TestBed.createComponent(AgentBoardDetail);
    fixture.componentRef.setInput('id', 'asm-1');
    fixture.detectChanges();
    await fixture.componentInstance.load();
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('NIS2 assessment');
    expect(root.textContent).toContain('Production subscription.');
    expect(root.textContent).toContain('50% complete');
    expect(root.textContent).toContain('Approve and review risk analysis policies.');
    expect(root.textContent).toContain('The policy is approved and reviewed annually.');
    expect(root.textContent).toContain('Access control policy');
    expect(root.textContent).toContain('The approved policy covers all production systems.');
    expect(root.textContent).toContain('get_requirement');
    expect(root.textContent).toContain('English');
    fixture.destroy();
  });
});
