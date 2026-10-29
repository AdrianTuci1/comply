import { McpScope } from '../../domain/access/mcp-access';

export interface McpKeyView {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedMcpKey {
  key: McpKeyView;
  secret: string;
}

/** Port: per-tenant MCP credentials stored by the API. */
export abstract class McpKeyGateway {
  abstract list(tenantId: string): Promise<readonly McpKeyView[]>;
  abstract create(
    tenantId: string,
    name: string,
    scopes: readonly McpScope[],
  ): Promise<CreatedMcpKey>;
  abstract revoke(tenantId: string, keyId: string): Promise<void>;
}
