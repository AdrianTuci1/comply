import { TestBed } from '@angular/core/testing';
import { APP_PROVIDERS } from '../../../app.providers';
import { Sources } from './sources';

describe('Sources', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Sources],
      providers: [...APP_PROVIDERS],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Sources);
    fixture.detectChanges();
    return fixture;
  }

  function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    element.value = value;
    element.dispatchEvent(new Event('input'));
  }

  it('shows managed coverage, sources and the first page of requirements', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.framework-card').length).toBe(4);
    expect(root.querySelectorAll('.source-row').length).toBe(5);
    expect(root.querySelectorAll('.req-row').length).toBe(8);
    expect(root.textContent).toContain(
      '29 requirements across 5 official sources · content managed by Comply',
    );
    expect(root.textContent).toContain('Managed content');
    expect(root.textContent).toContain('1–8 of 29 requirements');
    expect(root.textContent).toContain('Directive (EU) 2022/2555');
  });

  it('does not offer source creation or requirement publishing', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('.add-source')).toBeNull();
    expect(root.querySelector('.req-publish')).toBeNull();
    expect(root.querySelector('.req-edit')).toBeNull();
    expect(root.textContent).not.toContain('Add source');
    expect(root.textContent).not.toContain('Publish');
  });

  it('filters sources and requirements by framework', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    (root.querySelectorAll('.framework-card')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.source-row').length).toBe(1);
    expect(root.querySelectorAll('.req-row').length).toBe(7);
    expect(root.textContent).toContain('ISO/IEC 27001:2022');
    expect(root.querySelector('.requirements .count')?.textContent).toContain('7');
  });

  it('searches across references, titles and text', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    setValue(root.querySelector('.req-tools .input') as HTMLInputElement, 'cryptography');
    fixture.detectChanges();

    expect(root.querySelectorAll('.req-row').length).toBe(1);
    expect(root.textContent).toContain('Cryptography and encryption');
  });
});
