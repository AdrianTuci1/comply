import { Injectable } from '@angular/core';
import { McpScope } from '../../domain/access/mcp-access';
import {
  CreatedMcpKey,
  McpKeyGateway,
  McpKeyView,
} from '../../application/ports/mcp-key.gateway';
import { apiUrl } from './api-url';
import { sessionHeaders } from './session-headers';

@Injectable()
export class HttpMcpKeyGateway extends McpKeyGateway {
  override async list(tenantId: string): Promise<readonly McpKeyView[]> {
    const response = await fetch(apiUrl('/api/access/keys'), {
      headers: {
        accept: 'application/json',
        'x-comply-tenant': tenantId,
        ...sessionHeaders(),
      },
    });
    if (!response.ok) throw new Error(`Key list failed with ${response.status}.`);
    const payload = (await response.json()) as { keys?: McpKeyView[] };
    return payload.keys ?? [];
  }

  override async create(
    tenantId: string,
    name: string,
    scopes: readonly McpScope[],
  ): Promise<CreatedMcpKey> {
    const response = await fetch(apiUrl('/api/access/keys'), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-comply-tenant': tenantId,
        ...sessionHeaders(),
      },
      body: JSON.stringify({ name, scopes }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      key?: McpKeyView;
      secret?: string;
      error?: string;
    };
    if (!response.ok || !payload.key || !payload.secret) {
      throw new Error(payload.error ?? `Key creation failed with ${response.status}.`);
    }
    return { key: payload.key, secret: payload.secret };
  }

  override async revoke(tenantId: string, keyId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/access/keys/${encodeURIComponent(keyId)}`), {
      method: 'DELETE',
      headers: {
        accept: 'application/json',
        'x-comply-tenant': tenantId,
        ...sessionHeaders(),
      },
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Key revocation failed with ${response.status}.`);
    }
  }
}
