import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { publicUser } from "./users.mjs";

const MAGIC_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;

export function createAuth({
  secret = randomBytes(32).toString("hex"),
  now = () => Date.now(),
  users = null,
} = {}) {
  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(body)
      .digest("base64url");
    return `${body}.${signature}`;
  }

  function verify(token) {
    if (typeof token !== "string") return null;
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;

    const expected = createHmac("sha256", secret)
      .update(body)
      .digest("base64url");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      return null;

    try {
      const payload = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      );
      if (!payload.exp || payload.exp < now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function sessionFor(user) {
    const expiresAt = new Date(now() + SESSION_TTL_MS).toISOString();
    return {
      session: sign({
        kind: "session",
        email: user.email,
        exp: now() + SESSION_TTL_MS,
      }),
      expiresAt,
      user,
    };
  }

  function userFor(email) {
    const user = users?.find(email);
    return user ? publicUser(user) : legacyUserFor(email);
  }

  return {
    requestMagicLink(email) {
      const normalized = String(email ?? "")
        .trim()
        .toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
        throw new Error("Enter a valid email address.");
      }
      const expiresAt = new Date(now() + MAGIC_TTL_MS).toISOString();
      return {
        email: normalized,
        expiresAt,
        token: sign({
          kind: "magic",
          email: normalized,
          exp: now() + MAGIC_TTL_MS,
        }),
      };
    },

    verifyMagicLink(token) {
      const payload = verify(token);
      if (!payload || payload.kind !== "magic") {
        throw new Error("This sign-in link is invalid or has expired.");
      }
      const record = users?.find(payload.email);
      if (users && !record) {
        throw new Error("No account exists for this email.");
      }
      return sessionFor(
        record ? publicUser(record) : legacyUserFor(payload.email),
      );
    },

    async login(email, password) {
      const user = await users?.authenticate(email, password);
      if (!user) {
        const error = new Error("Email or password is incorrect.");
        error.status = 401;
        throw error;
      }
      return sessionFor(user);
    },

    async exchangeCode(code) {
      const payload = verify(code);
      if (!payload || payload.kind !== "oidc-code") {
        const error = new Error("This sign-in code is invalid or has expired.");
        error.status = 400;
        throw error;
      }
      const user = userFor(payload.email);
      if (!user) {
        const error = new Error("The account no longer exists.");
        error.status = 401;
        throw error;
      }
      return sessionFor(user);
    },

    issueCode(user) {
      return sign({
        kind: "oidc-code",
        email: user.email,
        exp: now() + CODE_TTL_MS,
      });
    },

    signState(payload) {
      return sign({ ...payload, exp: now() + STATE_TTL_MS });
    },

    verifyState(token) {
      const payload = verify(token);
      return payload?.kind === "oidc-state" ? payload : null;
    },

    session(token) {
      const payload = verify(token);
      return payload?.kind === "session" ? payload : null;
    },

    sessionFor,
    userFor,
  };
}

export function userFor(email) {
  return legacyUserFor(email);
}

function legacyUserFor(email) {
  return {
    email,
    name: displayName(email),
    organizationName: "Nordwind Logistics",
  };
}

function displayName(email) {
  const local = email.split("@")[0] ?? "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
