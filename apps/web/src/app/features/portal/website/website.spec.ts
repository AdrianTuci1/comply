import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_PROVIDERS } from '../../../app.providers';
import { TrustPage } from '../../trust/trust-page';
import { Website } from './website';

describe('Website publication settings', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Website, TrustPage],
      providers: [provideRouter([]), ...APP_PROVIDERS],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Website);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the header and logo as separate uploads', () => {
    const root: HTMLElement = render().nativeElement;

    expect(root.querySelector('.header-setting__preview img')?.getAttribute('src')).toBe(
      '/headers/nordwind.svg',
    );
    expect(root.querySelector('.logo-setting__preview img')?.getAttribute('src')).toBe(
      '/logos/nordwind.svg',
    );
    expect(root.querySelector('.header-setting input[type="file"]')).toBeTruthy();
    expect(root.querySelector('.logo-setting input[type="file"]')).toBeTruthy();
  });

  it('uploads a header image and removes it without touching the logo', async () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const input: HTMLInputElement = root.querySelector('.header-setting input[type="file"]')!;
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'banner.svg', {
      type: 'image/svg+xml',
    });

    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();

    expect(root.querySelector('.header-setting__preview img')?.getAttribute('src')).toContain(
      'data:image/svg+xml',
    );

    const remove = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.header-setting .btn'),
    ).find((button) => button.textContent?.includes('Remove'))!;
    remove.click();
    fixture.detectChanges();

    expect(root.querySelector('.header-setting__preview img')).toBeNull();
    expect(root.querySelector('.header-setting__preview')?.textContent).toContain('No header');
    expect(root.querySelector('.logo-setting__preview img')?.getAttribute('src')).toBe(
      '/logos/nordwind.svg',
    );
  });

  it('shows domain records and walks the verification states', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const action = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.hosting__actions .btn')).find(
        (button) => button.textContent?.includes(label),
      )!;

    expect(root.querySelector('.dns')?.textContent).toContain('edge.comply.app');
    expect(root.querySelector('.dns')?.textContent).toContain('_comply.trust.nordwind.ro');
    expect(root.querySelector('.domain-status')?.textContent).toContain('Verified');

    action('Reset verification').click();
    fixture.detectChanges();
    expect(root.querySelector('.domain-status')?.textContent).toContain('Not connected');

    action('Check DNS').click();
    fixture.detectChanges();
    expect(root.querySelector('.domain-status')?.textContent).toContain('Verifying');

    action('Confirm ownership (demo)').click();
    fixture.detectChanges();
    expect(root.querySelector('.domain-status')?.textContent).toContain('Verified');
  });

  it('publishes only the selected subprocessors on the public page', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.vendor-row').length).toBe(8);

    const awsRow = root.querySelector<HTMLElement>('[data-vendor="s-1"]')!;
    const awsSwitch = awsRow.querySelector<HTMLButtonElement>('.switch')!;
    expect(awsSwitch.getAttribute('aria-checked')).toBe('true');

    awsSwitch.click();
    fixture.detectChanges();

    expect(awsSwitch.getAttribute('aria-checked')).toBe('false');

    const publicPage = TestBed.createComponent(TrustPage);
    publicPage.componentRef.setInput('slug', 'nordwind');
    publicPage.componentRef.setInput('tab', 'subprocessors');
    publicPage.detectChanges();

    const publicRoot: HTMLElement = publicPage.nativeElement;
    expect(publicRoot.querySelectorAll('.row').length).toBe(7);
    expect(publicRoot.textContent).not.toContain('Amazon Web Services');
    expect(publicRoot.textContent).toContain('Cloudflare');
  });

  it('renames and hides control categories on the public page', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;

    const infrastructure = root.querySelector<HTMLElement>('[data-category="infrastructure"]')!;
    const nameInput = infrastructure.querySelector<HTMLInputElement>('input')!;
    nameInput.value = 'Infra';
    nameInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(root.querySelector('.mini-categories')?.textContent).toContain('Infra');

    const organizational = root.querySelector<HTMLElement>('[data-category="organizational"]')!;
    organizational.querySelector<HTMLButtonElement>('.switch')!.click();
    fixture.detectChanges();

    expect(root.querySelector('.mini-categories')?.textContent).not.toContain(
      'Organizational security',
    );

    const overview = TestBed.createComponent(TrustPage);
    overview.componentRef.setInput('slug', 'nordwind');
    overview.componentRef.setInput('tab', 'overview');
    overview.detectChanges();

    const overviewRoot: HTMLElement = overview.nativeElement;
    expect(overviewRoot.querySelectorAll('.control-card').length).toBe(3);
    expect(overviewRoot.querySelector('.control-card h3')?.textContent).toContain('Infra');
    expect(overviewRoot.textContent).not.toContain('Organizational security');

    const controls = TestBed.createComponent(TrustPage);
    controls.componentRef.setInput('slug', 'nordwind');
    controls.componentRef.setInput('tab', 'controls');
    controls.detectChanges();

    const controlsRoot: HTMLElement = controls.nativeElement;
    expect(controlsRoot.querySelectorAll('.group').length).toBe(3);
    expect(controlsRoot.querySelector('.group h2')?.textContent).toContain('Infra');
  });

  it('explains the self-hosted ingress and shows the container command', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const select: HTMLSelectElement = root.querySelector('.hosting select')!;

    select.value = 'self_hosted';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(root.querySelector('.hosting__mode')?.textContent).toContain(
      'Serving from your infrastructure',
    );
    expect(root.querySelector('.hosting__code')?.textContent).toContain('COMPLY_TRUST_HOST');
    expect(root.querySelector('.hosting__code')?.textContent).toContain('COMPLY_TRUST_SLUG');
    expect(root.querySelector('.dns')?.textContent).toContain('your ingress hostname');
  });
});
