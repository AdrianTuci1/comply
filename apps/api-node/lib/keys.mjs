import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const MCP_SCOPES = ["read", "evidence:write", "admin"];

const TENANT_PATTERN = "[a-z0-9][a-z0-9-]{1,39}";
const TENANT_RE = new RegExp(`^${TENANT_PATTERN}$`);
const TOKEN_RE = new RegExp(
  `^sk_mcp_(${TENANT_PATTERN})_([a-f0-9]{64})$`,
);
const LAST_USED_WRITE_MS = 60_000;

export class McpKeyError extends Error {
  constructor(message, { code = "invalid_key", status = 401 } = {}) {
    super(message);
    this.name = "McpKeyError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Per-tenant MCP credentials. The token embeds the tenant, but the tenant is
 * accepted only when the SHA-256 hash of the full token is on record.
 */
export class McpKeyRegistry {
  constructor({
    dataFile = null,
    now = () => new Date(),
    idFactory = randomUUID,
    secretFactory = () => randomBytes(32).toString("hex"),
  } = {}) {
    this.dataFile = dataFile;
    this.now = now;
    this.idFactory = idFactory;
    this.secretFactory = secretFactory;
    this.keys = new Map();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    if (!this.dataFile) return this;
    const data = await readJson(this.dataFile);
    const saved = Array.isArray(data?.keys) ? data.keys : [];
    for (const key of saved) {
      if (isKeyRecord(key)) this.keys.set(key.id, key);
    }
    return this;
  }

  async flush() {
    await this.writeQueue;
  }

  list(tenantId) {
    requireTenant(tenantId);
    return [...this.keys.values()]
      .filter((key) => key.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicKey);
  }

  create(tenantId, { name, scopes } = {}) {
    requireTenant(tenantId);
    const label = String(name ?? "").trim();
    if (!label) {
      throw new McpKeyError("The key needs a name.", {
        code: "invalid_name",
        status: 400,
      });
    }
    const permissions = normalizeScopes(scopes);
    const secret = `sk_mcp_${tenantId}_${this.secretFactory()}`;
    const record = {
      id: `key-${this.idFactory()}`,
      tenantId,
      name: label,
      prefix: secret.slice(0, secret.length - 64 + 6),
      hash: hashToken(secret),
      scopes: permissions,
      createdAt: this.now().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    this.keys.set(record.id, record);
    this.persist();
    return { key: publicKey(record), secret };
  }

  revoke(tenantId, keyId) {
    const record = this.keys.get(keyId);
    if (!record || record.tenantId !== tenantId) {
      throw new McpKeyError("The key was not found.", {
        code: "not_found",
        status: 404,
      });
    }
    if (!record.revokedAt) {
      record.revokedAt = this.now().toISOString();
      this.persist();
    }
    return publicKey(record);
  }

  /** Returns the key record when the token is valid, active, and tenant-bound. */
  authenticate(token) {
    const match = TOKEN_RE.exec(String(token ?? ""));
    if (!match) return null;
    const tenantId = match[1];
    const hash = hashToken(token);
    const record = [...this.keys.values()].find(
      (key) => key.hash === hash && key.tenantId === tenantId,
    );
    if (!record || record.revokedAt) return null;

    const now = this.now().toISOString();
    if (
      !record.lastUsedAt ||
      Date.parse(now) - Date.parse(record.lastUsedAt) > LAST_USED_WRITE_MS
    ) {
      record.lastUsedAt = now;
      this.persist();
    }
    return publicKey(record);
  }

  persist() {
    if (!this.dataFile) return;
    const payload = {
      version: 1,
      updatedAt: this.now().toISOString(),
      keys: [...this.keys.values()],
    };
    const task = () => writeJson(this.dataFile, payload);
    this.writeQueue = this.writeQueue
      .then(task, task)
      .catch((error) => console.error("MCP key save failed:", error));
  }
}

export function tenantFromToken(token) {
  const match = TOKEN_RE.exec(String(token ?? ""));
  return match ? match[1] : null;
}

function normalizeScopes(value) {
  const scopes = Array.isArray(value) ? [...new Set(value)] : [];
  if (scopes.length === 0) {
    throw new McpKeyError("Choose at least one permission for the key.", {
      code: "invalid_scopes",
      status: 400,
    });
  }
  const invalid = scopes.find((scope) => !MCP_SCOPES.includes(scope));
  if (invalid) {
    throw new McpKeyError(`Unknown access scope: ${invalid}.`, {
      code: "invalid_scopes",
      status: 400,
    });
  }
  return scopes;
}

function requireTenant(tenantId) {
  if (!TENANT_RE.test(String(tenantId ?? ""))) {
    throw new McpKeyError("The tenant identifier is invalid.", {
      code: "invalid_tenant",
      status: 400,
    });
  }
}

function publicKey(record) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    prefix: record.prefix,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isKeyRecord(value) {
  return (
    value &&
    typeof value.id === "string" &&
    TENANT_RE.test(value.tenantId) &&
    typeof value.hash === "string" &&
    Array.isArray(value.scopes) &&
    typeof value.createdAt === "string"
  );
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
