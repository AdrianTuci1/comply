import { McpAccess } from './mcp-access';

/** Port: persistence boundary for MCP keys and domain verification. */
export abstract class McpAccessRepository {
  abstract findAll(): readonly McpAccess[];
  abstract findByOrganization(organizationId: string): McpAccess | undefined;
  abstract save(access: McpAccess): void;
}
