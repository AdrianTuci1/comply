import { DomainError } from '../../shared-kernel/domain-error';
import { McpAccess, McpApiKey } from './mcp-access';

function key(id: string, scopes: readonly ('read' | 'evidence:write' | 'admin')[] = ['read']) {
  return McpApiKey.create({
    id,
    name: `Key ${id}`,
    prefix: 'sk_mcp_abc',
    scopes,
    createdAt: '2026-10-01T10:00:00.000Z',
  });
}

function access(): McpAccess {
  return McpAccess.create({
    organizationId: 'nordwind',
    deploymentMode: 'managed',
    domainToken: 'cmpl_nw_test',
  });
}

describe('McpAccess', () => {
  it('adds keys and masks the stored prefix', () => {
    const current = access().addKey(key('k-1', ['read', 'evidence:write']));

    expect(current.activeKeys.length).toBe(1);
    expect(current.keys[0].masked).toBe('sk_mcp_abc••••••••');
    expect(current.keys[0].scopes).toEqual(['read', 'evidence:write']);
  });

  it('refuses keys without a name or scopes', () => {
    expect(() =>
      McpApiKey.create({
        id: 'k-1',
        name: '  ',
        prefix: 'sk_mcp_abc',
        scopes: ['read'],
        createdAt: '2026-10-01T10:00:00.000Z',
      }),
    ).toThrow(DomainError);

    expect(() =>
      McpApiKey.create({
        id: 'k-2',
        name: 'Harness',
        prefix: 'sk_mcp_abc',
        scopes: [],
        createdAt: '2026-10-01T10:00:00.000Z',
      }),
    ).toThrow('at least one permission');
  });

  it('revokes a key and keeps it in the audit list', () => {
    const current = access().addKey(key('k-1')).revokeKey('k-1');

    expect(current.activeKeys.length).toBe(0);
    expect(current.keys[0].status).toBe('revoked');
    expect(() => current.revokeKey('k-1')).toThrow('already been revoked');
  });

  it('switches between managed and self-hosted modes', () => {
    const current = access().withDeploymentMode('self_hosted');

    expect(current.deploymentMode).toBe('self_hosted');
  });

  it('walks the domain check from unverified to verified and back', () => {
    const pending = access().beginDomainCheck();
    expect(pending.domain.status).toBe('pending');

    const verified = pending.verifyDomain('2026-10-29T12:00:00.000Z');
    expect(verified.domain.status).toBe('verified');
    expect(verified.domain.checkedAt).toBe('2026-10-29T12:00:00.000Z');

    expect(verified.resetDomain().domain.status).toBe('unverified');
  });

  it('round-trips through a snapshot without losing keys or domain state', () => {
    const snapshot = access()
      .addKey(key('k-1', ['admin']))
      .verifyDomain('2026-10-29T12:00:00.000Z')
      .toSnapshot();

    const restored = McpAccess.restore(snapshot);

    expect(restored.organizationId).toBe('nordwind');
    expect(restored.keys[0].scopes).toEqual(['admin']);
    expect(restored.domain.isVerified).toBe(true);
  });
});
