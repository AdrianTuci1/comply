import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_PROVIDERS } from '../../../app.providers';
import { Settings } from './settings';

describe('Settings — MCP access', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [provideRouter([]), ...APP_PROVIDERS],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    return fixture;
  }

  it('lists the managed endpoint and starts with no keys', () => {
    const root: HTMLElement = render().nativeElement;

    expect(root.querySelector('.mcp__count')?.textContent).toContain('0 active keys');
    expect(root.querySelector('.mcp__endpoint code')?.textContent).toContain(
      'https://mcp.comply.ro/nordwind/mcp',
    );
    expect(root.querySelectorAll('.key').length).toBe(0);
  });

  it('creates a tenant-bound key and shows the secret once', async () => {
    const fixture = render();
    const component = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;

    component.openKeyForm();
    component.keyName.set('Harness CI');
    await component.createKey();
    fixture.detectChanges();

    const secret = root.querySelector('.secret code')?.textContent?.trim() ?? '';
    expect(secret).toMatch(/^sk_mcp_nordwind_[0-9a-f]{64}$/);
    expect(root.querySelector('.mcp__count')?.textContent).toContain('1 active key');

    const dismiss = Array.from(root.querySelectorAll<HTMLButtonElement>('.secret .btn--sm')).find(
      (button) => button.textContent?.includes('I saved the key'),
    )!;
    dismiss.click();
    fixture.detectChanges();

    expect(root.querySelector('.secret')).toBeNull();
  });

  it('switches to self-hosted and updates the endpoint', () => {
    const fixture = render();
    const root: HTMLElement = fixture.nativeElement;
    const select: HTMLSelectElement = root.querySelector('.mcp__select')!;

    select.value = 'self_hosted';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(root.querySelector('.mcp__endpoint code')?.textContent).toContain(
      'https://trust.nordwind.ro/mcp',
    );
  });

  it('revokes a key and keeps it in the list', async () => {
    const fixture = render();
    const component = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;

    component.openKeyForm();
    component.keyName.set('Harness CI');
    await component.createKey();
    fixture.detectChanges();

    const keyId = component.keys()[0].id;
    await component.revokeKey(keyId);
    fixture.detectChanges();

    expect(root.querySelector('.mcp__count')?.textContent).toContain('0 active keys');
    expect(root.querySelectorAll('.key--revoked').length).toBe(1);
  });
});
