import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { APP_PROVIDERS } from '../../../app.providers';
import { ComplianceFacade } from '../../../application/compliance.facade';
import {
  AgentAssessment,
  AgentAssessmentSummary,
  AgentGateway,
} from '../../../application/ports/agent-gateway';
import { Boards } from './boards';

const AGENT_BOARD: AgentAssessmentSummary = {
  assessment_id: 'asm-1',
  name: 'NIS2 assessment from the agent',
  framework: 'nis2',
  phase: 'collect',
  scope: 'Production subscription.',
  period: { from: '2026-01-01', to: '2026-12-31' },
  progress: {
    total: 2,
    completed: 1,
    not_applicable: 0,
    evidence_collected: 0,
    open: 1,
    evidence: 1,
    percent: 50,
  },
  updated_at: '2026-10-29T10:00:00.000Z',
};

class FakeAgentGateway extends AgentGateway {
  override async list(): Promise<readonly AgentAssessmentSummary[]> {
    return [AGENT_BOARD];
  }

  override async get(): Promise<AgentAssessment> {
    throw new Error('Not needed in this test.');
  }
}

describe('Boards', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Boards],
      providers: [provideRouter([]), ...APP_PROVIDERS],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Boards);
    fixture.detectChanges();
    return fixture;
  }

  it('lists only the boards of the active organisation', () => {
    const fixture = render();
    const cards = fixture.nativeElement.querySelectorAll('.board-card');

    expect(cards.length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('NIS2 — 2026 assessment');
    expect(fixture.nativeElement.textContent).not.toContain('NIS2 — Essential entity');
  });

  it('deactivates a board and hides it until deactivated boards are shown', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const deactivate = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.board-card button'),
    ).find((button) => button.textContent?.trim() === 'Deactivate')!;

    deactivate.click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.board-card').length).toBe(2);
    expect(root.textContent).toContain('Deactivated (1)');
    expect(root.querySelector('.notice')?.textContent).toContain('was deactivated');

    const toggle = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.boards__tools .chip'),
    ).find((button) => button.textContent?.includes('Deactivated (1)'))!;
    toggle.click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.board-card').length).toBe(3);
    expect(root.querySelector('.board-card--inactive')).toBeTruthy();
  });

  it('filters boards by framework', () => {
    const fixture = render();
    const chips: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.chips .chip'),
    );
    const isoChip = chips.find((chip) => chip.textContent?.trim() === 'ISO 27001');

    isoChip!.click();
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.board-card');
    expect(cards.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('ISO 27001 — Recertification');
  });

  it('creates a board through the domain factory and navigates to it', async () => {
    const fixture = render();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compliance = TestBed.inject(ComplianceFacade);

    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('.btn--primary')!;
    trigger.click();
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      '.create input[type="text"]',
    )!;
    input.value = 'NIS2 — Test 2027';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form: HTMLFormElement = fixture.nativeElement.querySelector('.create')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    const created = compliance.boards().find((board) => board.name === 'NIS2 — Test 2027');
    expect(created).toBeTruthy();
    expect(created?.organizationId).toBe('nordwind');
    expect(created?.total).toBe(12);
    expect(created?.status).toBe('draft');
    expect(created?.toSnapshot().items[0].title).toBe('Risk analysis policies');
    expect(created?.toSnapshot().items[0].description).toContain('cybersecurity risk analysis');
    expect(navigate).toHaveBeenCalledWith(['/workspace/boards', created!.id]);
  });

  it('rejects board names that are too short', async () => {
    const fixture = render();
    const compliance = TestBed.inject(ComplianceFacade);
    const before = compliance.boards().length;

    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('.btn--primary')!;
    trigger.click();
    fixture.detectChanges();

    const form: HTMLFormElement = fixture.nativeElement.querySelector('.create')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compliance.boards().length).toBe(before);
    expect(fixture.nativeElement.querySelector('.field__error')?.textContent).toContain(
      'at least 3 characters',
    );
  });
});

describe('Boards with agent assessments', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Boards],
      providers: [
        provideRouter([]),
        ...APP_PROVIDERS,
        { provide: AgentGateway, useClass: FakeAgentGateway },
      ],
    }).compileComponents();
  });

  it('shows agent boards with progress and links to the board view', async () => {
    const fixture = TestBed.createComponent(Boards);
    fixture.detectChanges();
    await fixture.componentInstance.loadAgentBoards();
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Agent boards');
    expect(root.textContent).toContain('NIS2 assessment from the agent');
    expect(root.textContent).toContain('Production subscription.');
    expect(root.textContent).toContain('50%');
    expect(root.querySelector('.board-card--agent')).toBeTruthy();
    expect(root.querySelector('.board-card--agent a')?.getAttribute('href')).toContain(
      '/workspace/boards/agent/asm-1',
    );
  });
});
