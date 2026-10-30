import { TestBed } from '@angular/core/testing';
import { APP_PROVIDERS } from '../app.providers';
import { McpAccessFacade } from './mcp-access.facade';

describe('McpAccessFacade', () => {
  let facade: McpAccessFacade;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [...APP_PROVIDERS] });
    facade = TestBed.inject(McpAccessFacade);
  });

  it('creates a key, returns the secret once and stores only metadata', () => {
    const result = facade.createKey('nordwind', 'Harness local', ['read', 'evidence:write']);

    expect(result.isSuccess).toBe(true);
    expect(result.value.secret).toMatch(/^sk_mcp_[0-9a-f]{48}$/);

    const access = facade.accessFor('nordwind')!;
    expect(access.activeKeys.length).toBe(3);
    expect(access.keys.some((key) => key.prefix === result.value.secret.slice(0, 11))).toBe(true);
    expect(access.toSnapshot().keys.some((key) => 'secret' in key)).toBe(false);
  });

  it('rejects invalid key input without changing the state', () => {
    const before = facade.accessFor('nordwind')!.keys.length;
    const result = facade.createKey('nordwind', '   ', ['read']);

    expect(result.isFailure).toBe(true);
    expect(facade.accessFor('nordwind')!.keys.length).toBe(before);
  });

  it('switches the deployment mode and verifies the domain', () => {
    expect(facade.setDeploymentMode('nordwind', 'self_hosted').isSuccess).toBe(true);
    expect(facade.accessFor('nordwind')!.deploymentMode).toBe('self_hosted');

    expect(facade.beginDomainCheck('nordwind').isSuccess).toBe(true);
    expect(facade.accessFor('nordwind')!.domain.status).toBe('pending');

    expect(facade.verifyDomain('nordwind').isSuccess).toBe(true);
    expect(facade.accessFor('nordwind')!.domain.isVerified).toBe(true);
  });

  it('creates a default managed access for a tenant without configuration', () => {
    const result = facade.setDeploymentMode('new-tenant', 'managed');

    expect(result.isSuccess).toBe(true);
    expect(result.value.domain.token).toMatch(/^cmpl_[0-9a-f]{16}$/);
    expect(result.value.activeKeys.length).toBe(0);
  });
});
