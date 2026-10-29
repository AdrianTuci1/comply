import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_PROVIDERS } from '../../../app.providers';
import { ComplianceFacade } from '../../../application/compliance.facade';
import { BoardDetail } from './board-detail';

describe('BoardDetail', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [BoardDetail],
      providers: [provideRouter([]), ...APP_PROVIDERS],
    }).compileComponents();
  });

  function render(id = 'b-nis2-2026') {
    const fixture = TestBed.createComponent(BoardDetail);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  function rowByRef(root: HTMLElement, ref: string): HTMLButtonElement {
    const rows: HTMLButtonElement[] = Array.from(root.querySelectorAll('.item-row'));
    return rows.find((row) => row.querySelector('.item-row__ref')?.textContent?.trim() === ref)!;
  }

  function actionButton(root: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.panel__actions .btn')).find(
      (button) => button.textContent?.trim() === label,
    )!;
  }

  it('renders the board summary and its checklist items', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('.head__title')?.textContent).toContain('NIS2 — 2026 assessment');
    expect(root.querySelectorAll('.item-row').length).toBe(14);
    expect(root.querySelector('.panel__title h2')?.textContent).toContain(
      'Risk analysis and information system security policies',
    );
    expect(root.querySelector('.item-row__desc')?.textContent).toContain(
      'cybersecurity risk analysis policies',
    );
    expect(root.querySelector('.panel__description')?.textContent).toContain(
      'cybersecurity risk analysis policies',
    );
  });

  it('filters items by status', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const chips: HTMLButtonElement[] = Array.from(root.querySelectorAll('.chips .chip'));
    const notStarted = chips.find((chip) => chip.textContent?.includes('Not started'));

    notStarted!.click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.item-row').length).toBe(2);
  });

  it('accepts an item and keeps board counters in sync', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const compliance = TestBed.inject(ComplianceFacade);

    rowByRef(root, '21(2)(d)').click();
    fixture.detectChanges();

    actionButton(root, 'Accept').click();
    fixture.detectChanges();

    const board = compliance.boardById('b-nis2-2026')!;
    expect(board.itemById('i-4')?.status).toBe('accepted');
    expect(board.accepted).toBe(42);
    expect(root.querySelector('.saved')?.textContent).toContain('accepted');
  });

  it('opens the evidence attached to an item', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    rowByRef(root, '21(2)(a)').click();
    fixture.detectChanges();

    const artifact = root.querySelector<HTMLButtonElement>('.evidence__open')!;
    expect(artifact.textContent).toContain('Approved policy');

    artifact.click();
    fixture.detectChanges();

    expect(root.querySelector('.evidence-doc__meta')?.textContent).toContain('Document');
    expect(root.querySelector('.evidence-doc__meta')?.textContent).toContain('Manual upload');
    expect(root.querySelector('.evidence-doc__body')?.textContent).toContain('Purpose');

    (root.querySelector('.evidence-doc__actions .btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelector('.evidence-doc')).toBeNull();
  });

  it('blocks acceptance without evidence and explains why', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    rowByRef(root, '21(2)(j)').click();
    fixture.detectChanges();

    const accept = actionButton(root, 'Accept');
    expect(accept.disabled).toBe(true);
    expect(root.querySelector('.panel__rule')?.textContent).toContain(
      'at least one piece of evidence',
    );
  });

  it('saves a conclusion for the selected item', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const compliance = TestBed.inject(ComplianceFacade);

    rowByRef(root, '21(2)(d)').click();
    fixture.detectChanges();

    const textarea: HTMLTextAreaElement = root.querySelector('.panel__conclusion textarea')!;
    textarea.value = 'Critical suppliers are reviewed annually, with signed security clauses.';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    actionButton(root, 'Save conclusion').click();
    fixture.detectChanges();

    expect(compliance.boardById('b-nis2-2026')?.itemById('i-4')?.conclusion).toContain(
      'Critical suppliers',
    );
    expect(root.querySelector('.saved')?.textContent).toContain('conclusion was saved');
  });

  it('shows an empty state for unknown boards', () => {
    const fixture = render('missing-board');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('.empty h3')?.textContent).toContain('Board not found');
  });
});
