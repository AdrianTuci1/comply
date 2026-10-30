import { Injectable } from '@angular/core';
import { McpAccess } from '../../domain/access/mcp-access';
import { McpAccessRepository } from '../../domain/access/mcp-access.repository';
import { MCP_ACCESS_FIXTURES } from './fixtures/mcp-access.fixtures';

@Injectable()
export class InMemoryMcpAccessRepository extends McpAccessRepository {
  private readonly store = new Map<string, McpAccess>(
    MCP_ACCESS_FIXTURES.map((fixture) => {
      const access = McpAccess.restore(fixture);
      return [access.organizationId, access];
    }),
  );

  findAll(): readonly McpAccess[] {
    return [...this.store.values()];
  }

  findByOrganization(organizationId: string): McpAccess | undefined {
    return this.store.get(organizationId);
  }

  save(access: McpAccess): void {
    this.store.set(access.organizationId, access);
  }
}
