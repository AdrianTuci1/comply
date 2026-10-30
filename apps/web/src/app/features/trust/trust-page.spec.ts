import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_PROVIDERS } from '../../app.providers';
import { OrganizationStore } from '../../application/organization.store';
import { TrustPage } from './trust-page';

describe('TrustPage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [TrustPage],
      providers: [...APP_PROVIDERS, provideRouter([])],
    }).compileComponents();
  });

  function render(slug: string, tab = 'overview') {
    const fixture = TestBed.createComponent(TrustPage);
    fixture.componentRef.setInput('slug', slug);
    fixture.componentRef.setInput('tab', tab);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the header, hero and tabs around the published overview', () => {
    const fixture = render('nordwind');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('app-trust-header img')?.getAttribute('src')).toBe(
      '/logos/nordwind.svg',
    );
    expect(root.querySelector('app-trust-header')?.textContent?.trim()).toBe('');
    expect(root.querySelector('app-trust-header .header__banner')).toBeNull();
    expect(root.querySelector('.hero__banner')?.getAttribute('src')).toBe('/headers/nordwind.svg');
    expect(root.querySelector('.hero__inner')).toBeNull();
    expect(root.querySelector('app-trust-header button')).toBeNull();
    expect(root.querySelectorAll('.tabs__actions button').length).toBe(2);
    expect(root.querySelector('.hero h1')?.textContent).toContain('Trust, built on evidence');
    expect(root.querySelector('.tab.is-active')?.textContent).toContain('Overview');
    expect(root.querySelectorAll('.tab').length).toBe(5);
    expect(root.querySelector('.hero .pill')).toBeNull();
    expect(root.querySelectorAll('.control-card').length).toBe(4);
    expect(root.querySelector('app-trust-overview')).toBeTruthy();
  });

  it('falls back to the logo and hero copy when no header image is uploaded', () => {
    const fixture = render('helios');
    const root: HTMLElement = fixture.nativeElement;
    const header: HTMLElement = root.querySelector('app-trust-header')!;

    expect(header.querySelector('img')?.getAttribute('src')).toBe('/logos/helios.svg');
    expect(header.querySelector('.header__banner')).toBeNull();
    expect(root.querySelector('.hero__banner')).toBeNull();
    expect(root.querySelector('.hero__inner')).toBeTruthy();
  });

  it('opens a public resource document and keeps gated files behind a request', () => {
    const fixture = render('nordwind', 'resources');
    const root: HTMLElement = fixture.nativeElement;

    const openButtons = root.querySelectorAll<HTMLButtonElement>('.resource .open');
    expect(openButtons.length).toBeGreaterThan(0);

    openButtons[0].click();
    fixture.detectChanges();

    expect(root.querySelector('.document__lead')?.textContent).toContain(
      'Vendors that process data',
    );
    expect(root.querySelector('.document__body')?.textContent).toContain('Inventory');

    (root.querySelector('.panel__head .btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.document')).toBeNull();
  });

  it('shows compliance, resources and the NDA call to action', () => {
    const fixture = render('nordwind');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.textContent).toContain('Aligned (declared)');
    expect(root.textContent).toContain('SOC 2');
    expect(root.textContent).toContain('NIS2 Report 2026');
    expect(root.querySelectorAll('.compliance-card').length).toBe(4);
    expect(root.querySelector('.nda')).toBeTruthy();
  });

  it('states who published the page and that it is not a certification', () => {
    const fixture = render('nordwind');
    const foot: HTMLElement = fixture.nativeElement.querySelector('.foot')!;

    expect(foot.textContent).toContain('Published by Nordwind Logistics');
    expect(foot.textContent).toContain('not a certification');
  });

  it('falls back to the overview for an unknown tab', () => {
    const fixture = render('nordwind', 'unknown');

    expect(fixture.nativeElement.querySelector('.tab.is-active')?.textContent).toContain(
      'Overview',
    );
    expect(fixture.nativeElement.querySelector('app-trust-overview')).toBeTruthy();
  });

  it('stacks every control group and filters them by search', () => {
    const fixture = render('nordwind', 'controls');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.group').length).toBe(4);
    expect(root.querySelectorAll('.table tbody tr').length).toBe(5);
    expect(root.querySelector('.group h2')?.textContent).toContain('Infrastructure security');

    const input: HTMLInputElement = root.querySelector('.search__input')!;
    input.value = 'segregation';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(root.querySelectorAll('.group').length).toBe(1);
    expect(root.querySelectorAll('.table tbody tr').length).toBe(1);
    expect(root.textContent).toContain('Strict environment segregation');
  });

  it('paginates resources and changes category', () => {
    const fixture = render('nordwind', 'resources');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.resource').length).toBe(6);
    expect(root.textContent).toContain('1–6 of 8 resources');

    const next: HTMLButtonElement = root.querySelectorAll(
      '.pagination__btn',
    )[1] as HTMLButtonElement;
    next.click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.resource').length).toBe(2);
    expect(root.textContent).toContain('7–8 of 8 resources');

    const privacy: HTMLButtonElement = root.querySelectorAll('.category')[1] as HTMLButtonElement;
    privacy.click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.resource').length).toBe(3);
    expect(root.textContent).toContain('1–3 of 3 resources');
  });

  it('lists subprocessors with purpose and region', () => {
    const fixture = render('nordwind', 'subprocessors');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.row').length).toBe(8);
    expect(root.textContent).toContain('Amazon Web Services');
    expect(root.textContent).toContain('Cloud hosting');
    expect(root.textContent).toContain('Global');
  });

  it('drops the subprocessor tab when the tenant publishes no vendor', () => {
    const store = TestBed.inject(OrganizationStore);
    store.updateTrustCenter({
      hiddenSubprocessors: ['s-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-7', 's-8'],
    });

    const fixture = render('nordwind');
    const root: HTMLElement = fixture.nativeElement;

    const tabs = Array.from(root.querySelectorAll('.tab')).map((tab) => tab.textContent?.trim());
    expect(tabs.length).toBe(4);
    expect(tabs).not.toContain('Subprocessors');
  });

  it('uses the category names and visibility from the management settings', () => {
    const store = TestBed.inject(OrganizationStore);
    store.updateTrustCenter({
      categoryLabels: { infrastructure: 'Infra' },
      hiddenCategories: ['organizational'],
    });

    const overview = render('nordwind');
    const overviewRoot: HTMLElement = overview.nativeElement;

    expect(overviewRoot.querySelectorAll('.control-card').length).toBe(3);
    expect(overviewRoot.querySelector('.control-card h3')?.textContent).toContain('Infra');
    expect(overviewRoot.textContent).not.toContain('Organizational security');

    const controls = render('nordwind', 'controls');
    const controlsRoot: HTMLElement = controls.nativeElement;

    expect(controlsRoot.querySelectorAll('.group').length).toBe(3);
    expect(controlsRoot.querySelector('.group h2')?.textContent).toContain('Infra');
  });

  it('paginates updates and expands a body', () => {
    const fixture = render('nordwind', 'updates');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.update').length).toBe(4);
    expect(root.textContent).toContain('1–4 of 5 updates');

    const toggle: HTMLButtonElement = root.querySelector('.toggle')!;
    toggle.click();
    fixture.detectChanges();

    expect(root.querySelector('.update__body')?.classList).toContain('is-open');
  });

  it('opens the access dialog and prepares a mail request', () => {
    const fixture = render('nordwind');
    const root: HTMLElement = fixture.nativeElement;

    (root.querySelector('.access') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelector('.panel h2')?.textContent).toContain('Request audit report');

    const inputs = root.querySelectorAll<HTMLInputElement>('.field input');
    inputs[0].value = 'Ana Pop';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = 'ana@example.com';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('.primary--full') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelector('.success h3')?.textContent).toContain('Request ready');
    expect(root.querySelector('.success a')?.getAttribute('href')).toContain('mailto:');
  });

  it('opens the subscribe dialog from the topbar', () => {
    const fixture = render('nordwind');

    (fixture.nativeElement.querySelector('.ghost') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.panel h2')?.textContent).toContain(
      'Subscribe to updates',
    );
  });

  it('hides unpublished trust pages behind a 404 state', () => {
    const fixture = render('studio-mic');
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('.missing h1')?.textContent).toContain('Page not available');
    expect(root.querySelector('.tab')).toBeNull();
    expect(root.querySelector('app-trust-header')).toBeNull();
  });

  it('returns the 404 state for unknown slugs', () => {
    const fixture = render('unknown-company');

    expect(fixture.nativeElement.querySelector('.missing h1')).toBeTruthy();
  });
});
