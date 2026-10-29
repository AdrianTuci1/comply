import { Injectable } from '@angular/core';
import { McpScope } from '../../domain/access/mcp-access';
import {
  CreatedMcpKey,
  McpKeyGateway,
  McpKeyView,
} from '../../application/ports/mcp-key.gateway';

@Injectable()
export class InMemoryMcpKeyGateway extends McpKeyGateway {
  private readonly store = new Map<string, McpKeyView>();

  override async list(tenantId: string): Promise<readonly McpKeyView[]> {
    return [...this.store.values()]
      .filter((key) => key.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  override async create(
    tenantId: string,
    name: string,
    scopes: readonly McpScope[],
  ): Promise<CreatedMcpKey> {
    const secret = `sk_mcp_${tenantId}_${randomHex(32)}`;
    const key: McpKeyView = {
      id: `key-${tenantId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      tenantId,
      name: name.trim(),
      prefix: secret.slice(0, secret.length - 64 + 6),
      scopes: [...scopes],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.store.set(key.id, key);
    return { key, secret };
  }

  override async revoke(tenantId: string, keyId: string): Promise<void> {
    const key = this.store.get(keyId);
    if (!key || key.tenantId !== tenantId) throw new Error('The key was not found.');
    this.store.set(keyId, { ...key, revokedAt: new Date().toISOString() });
  }
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto?.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}
