import { Injectable, inject, signal } from '@angular/core';
import { DeploymentMode, McpAccess, McpApiKey, McpScope } from '../domain/access/mcp-access';
import { McpAccessRepository } from '../domain/access/mcp-access.repository';
import { Result } from '../shared-kernel/result';

export interface CreatedMcpKey {
  access: McpAccess;
  key: McpApiKey;
  /** Shown once after creation; only the prefix is persisted. */
  secret: string;
}

/** Use cases for MCP credentials and custom-domain ownership. */
@Injectable({ providedIn: 'root' })
export class McpAccessFacade {
  private readonly repository = inject(McpAccessRepository);

  private readonly state = signal<readonly McpAccess[]>(this.repository.findAll());

  accessFor(organizationId: string): McpAccess | undefined {
    return this.state().find((access) => access.organizationId === organizationId);
  }

  setDeploymentMode(organizationId: string, mode: DeploymentMode): Result<McpAccess> {
    return this.mutate(organizationId, (access) => access.withDeploymentMode(mode));
  }

  createKey(
    organizationId: string,
    name: string,
    scopes: readonly McpScope[],
    now = new Date().toISOString(),
  ): Result<CreatedMcpKey> {
    try {
      const secret = generateSecret();
      const key = McpApiKey.create({
        id: `key-${organizationId}-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        name,
        prefix: secret.slice(0, 11),
        scopes,
        createdAt: now,
      });
      const updated = this.mutate(organizationId, (access) => access.addKey(key));
      if (updated.isFailure) {
        return Result.fail(updated.error!);
      }
      return Result.ok({ access: updated.value, key, secret });
    } catch (error) {
      return this.failure(error, 'The key could not be generated.');
    }
  }

  revokeKey(organizationId: string, keyId: string): Result<McpAccess> {
    return this.mutate(organizationId, (access) => access.revokeKey(keyId));
  }

  beginDomainCheck(organizationId: string): Result<McpAccess> {
    return this.mutate(organizationId, (access) => access.beginDomainCheck());
  }

  verifyDomain(organizationId: string, now = new Date().toISOString()): Result<McpAccess> {
    return this.mutate(organizationId, (access) => access.verifyDomain(now));
  }

  resetDomain(organizationId: string): Result<McpAccess> {
    return this.mutate(organizationId, (access) => access.resetDomain());
  }

  private mutate(
    organizationId: string,
    action: (access: McpAccess) => McpAccess,
  ): Result<McpAccess> {
    const existing = this.accessFor(organizationId);
    const access =
      existing ??
      McpAccess.create({
        organizationId,
        deploymentMode: 'managed',
        domainToken: generateDomainToken(),
      });

    try {
      const updated = action(access);
      this.repository.save(updated);
      this.state.update((items) =>
        existing
          ? items.map((item) => (item.organizationId === organizationId ? updated : item))
          : [...items, updated],
      );
      return Result.ok(updated);
    } catch (error) {
      return this.failure(error, 'The setting could not be applied.');
    }
  }

  private failure(error: unknown, fallback: string): Result<never> {
    return Result.fail(error instanceof Error ? error.message : fallback);
  }
}

function generateSecret(): string {
  return `sk_mcp_${randomHex(24)}`;
}

function generateDomainToken(): string {
  return `cmpl_${randomHex(8)}`;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    for (let index = 0; index < buffer.length; index += 1) {
      buffer[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}
