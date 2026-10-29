import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const MIN_PASSWORD = 10;

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

/**
 * Local accounts for password sign-in. OIDC accounts are recorded here on first
 * sign-in so both paths produce the same session user.
 */
export class UserRegistry {
  constructor({ dataFile = null, now = () => new Date(), seeds = [] } = {}) {
    this.dataFile = dataFile;
    this.now = now;
    this.seeds = seeds;
    this.users = [];
    this.writeQueue = Promise.resolve();
  }

  async init() {
    if (this.dataFile) {
      try {
        const raw = JSON.parse(await readFile(this.dataFile, "utf8"));
        this.users = Array.isArray(raw.users) ? raw.users : [];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    if (this.assignMissingRoles()) {
      await this.flush();
    }

    for (const seed of this.seeds) {
      if (!this.find(seed.email)) {
        await this.create({ ...seed, allowSeed: true });
      }
    }

    if (!this.dataFile) return;
    await mkdir(dirname(this.dataFile), { recursive: true });
    await this.flush();
  }

  /** Older files predate roles. The first account owns the installation. */
  assignMissingRoles() {
    let changed = false;
    for (const [index, user] of this.users.entries()) {
      if (!user.role) {
        user.role = index === 0 ? "admin" : "member";
        changed = true;
      }
    }
    if (this.users.length > 0 && !this.users.some((user) => user.role === "admin")) {
      this.users[0].role = "admin";
      changed = true;
    }
    return changed;
  }

  list() {
    return this.users.map((user) => publicUser(user));
  }

  find(email) {
    const normalized = normalizeEmail(email);
    return this.users.find((user) => user.email === normalized) ?? null;
  }

  async create({ email, name, password, organizationName, allowSeed = false }) {
    const normalized = normalizeEmail(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new UserError("Enter a valid email address.");
    }
    if (this.find(normalized)) {
      throw new UserError("An account with this email already exists.", 409);
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      throw new UserError(
        `Use a password with at least ${MIN_PASSWORD} characters.`,
      );
    }

    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(password, salt, KEY_LENGTH)).toString("hex");
    const user = {
      email: normalized,
      name:
        String(name ?? displayName(normalized)).trim() ||
        displayName(normalized),
      organizationName: String(organizationName ?? "Nordwind Logistics").trim(),
      role: this.users.length === 0 ? "admin" : "member",
      salt,
      hash,
      providers: ["password"],
      createdAt: this.now().toISOString(),
      ...(allowSeed ? { seeded: true } : {}),
    };
    this.users.push(user);
    await this.flush();
    return publicUser(user);
  }

  async ensureExternal({ email, name, provider }) {
    const normalized = normalizeEmail(email);
    const existing = this.find(normalized);
    if (existing) {
      if (!existing.providers.includes(provider)) {
        existing.providers.push(provider);
        await this.flush();
      }
      return publicUser(existing);
    }

    const user = {
      email: normalized,
      name:
        String(name ?? displayName(normalized)).trim() ||
        displayName(normalized),
      organizationName: "Nordwind Logistics",
      role: this.users.length === 0 ? "admin" : "member",
      salt: null,
      hash: null,
      providers: [provider],
      createdAt: this.now().toISOString(),
    };
    this.users.push(user);
    await this.flush();
    return publicUser(user);
  }

  async authenticate(email, password) {
    const user = this.find(email);
    if (!user?.salt || !user.hash || typeof password !== "string") return null;
    const candidate = await scrypt(password, user.salt, KEY_LENGTH);
    const expected = Buffer.from(user.hash, "hex");
    if (candidate.length !== expected.length) return null;
    return timingSafeEqual(candidate, expected) ? publicUser(user) : null;
  }

  async flush() {
    if (!this.dataFile) return;
    this.writeQueue = this.writeQueue.then(async () => {
      const payload = {
        version: 1,
        updatedAt: this.now().toISOString(),
        users: this.users,
      };
      const temp = `${this.dataFile}.tmp`;
      await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`);
      await rename(temp, this.dataFile);
    });
    await this.writeQueue;
  }
}

export function seedUsersFromEnv(env = process.env) {
  const email = env.COMPLY_SEED_EMAIL;
  const password = env.COMPLY_SEED_PASSWORD;
  if (email && password) {
    return [
      {
        email,
        password,
        name: env.COMPLY_SEED_NAME ?? displayName(email),
        organizationName: env.COMPLY_SEED_ORGANIZATION ?? "Nordwind Logistics",
      },
    ];
  }
  if (env.NODE_ENV !== "production" || env.COMPLY_DEMO_LOGIN === "1") {
    return [
      {
        email: "adrian@comply.ro",
        password: "comply-demo",
        name: "Adrian",
        organizationName: "Nordwind Logistics",
      },
    ];
  }
  return [];
}

export function publicUser(user) {
  return {
    email: user.email,
    name: user.name,
    organizationName: user.organizationName,
    role: user.role ?? "member",
  };
}

function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function displayName(email) {
  const local = String(email).split("@")[0] ?? "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
