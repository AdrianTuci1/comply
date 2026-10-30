import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";

const JWKS_TTL_MS = 60 * 60 * 1000;

export class OidcError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "OidcError";
    this.status = status;
  }
}

export function oidcProviders(env = process.env) {
  const providers = [];
  const add = (provider) => {
    if (provider.clientId && provider.clientSecret) providers.push(provider);
  };

  add({
    id: "google",
    label: "Google",
    kind: "oidc",
    issuer: "https://accounts.google.com",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    userInfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    clientId: env.COMPLY_OIDC_GOOGLE_CLIENT_ID,
    clientSecret: env.COMPLY_OIDC_GOOGLE_CLIENT_SECRET,
    scopes: ["openid", "email", "profile"],
  });

  const tenant = env.COMPLY_OIDC_MICROSOFT_TENANT || "common";
  add({
    id: "microsoft",
    label: "Microsoft",
    kind: "oidc",
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    jwksUri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
    clientId: env.COMPLY_OIDC_MICROSOFT_CLIENT_ID,
    clientSecret: env.COMPLY_OIDC_MICROSOFT_CLIENT_SECRET,
    scopes: ["openid", "profile", "email"],
  });

  add({
    id: "github",
    label: "GitHub",
    kind: "oauth2",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    userEndpoint: "https://api.github.com/user",
    emailsEndpoint: "https://api.github.com/user/emails",
    clientId: env.COMPLY_OIDC_GITHUB_CLIENT_ID,
    clientSecret: env.COMPLY_OIDC_GITHUB_CLIENT_SECRET,
    scopes: ["read:user", "user:email"],
  });

  add({
    id: env.COMPLY_OIDC_ID || "sso",
    label: env.COMPLY_OIDC_LABEL || "Single sign-on",
    kind: "oidc",
    issuer: env.COMPLY_OIDC_ISSUER,
    authorizationEndpoint: env.COMPLY_OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: env.COMPLY_OIDC_TOKEN_ENDPOINT,
    jwksUri: env.COMPLY_OIDC_JWKS_URI,
    userInfoEndpoint: env.COMPLY_OIDC_USERINFO_ENDPOINT,
    clientId: env.COMPLY_OIDC_CLIENT_ID,
    clientSecret: env.COMPLY_OIDC_CLIENT_SECRET,
    scopes: ["openid", "email", "profile"],
  });

  return providers.filter(
    (provider) =>
      provider.authorizationEndpoint &&
      provider.tokenEndpoint &&
      (provider.kind === "oauth2" || provider.jwksUri),
  );
}

export function createOidc({
  providers = oidcProviders(),
  auth,
  users,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  if (!auth) throw new Error("OIDC requires the auth service.");
  const jwksCache = new Map();

  function find(providerId) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider)
      throw new OidcError("This sign-in provider is not configured.", 404);
    return provider;
  }

  function callbackUrl(provider, origin) {
    return `${origin.replace(/\/$/, "")}/api/auth/oidc/${provider.id}/callback`;
  }

  function publicList() {
    return providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      kind: provider.kind,
    }));
  }

  function begin(providerId, origin) {
    const provider = find(providerId);
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const nonce = base64url(randomBytes(16));
    const state = auth.signState({
      kind: "oidc-state",
      provider: provider.id,
      verifier,
      nonce,
    });
    const url = new URL(provider.authorizationEndpoint);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", callbackUrl(provider, origin));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", provider.scopes.join(" "));
    url.searchParams.set("state", state);
    if (provider.kind === "oidc") {
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  async function complete(providerId, { code, state, error, origin }) {
    const provider = find(providerId);
    if (error) throw new OidcError(providerErrorMessage(error));
    if (!code)
      throw new OidcError("The provider did not return an authorization code.");

    const saved = auth.verifyState(state);
    if (!saved || saved.provider !== provider.id) {
      throw new OidcError("The sign-in request expired. Start again.");
    }

    const tokens = await exchangeCode(provider, {
      code,
      verifier: saved.verifier,
      redirectUri: callbackUrl(provider, origin),
    });

    let profile;
    if (provider.kind === "oauth2") {
      profile = await githubProfile(provider, tokens.access_token);
    } else {
      profile = await oidcProfile(provider, tokens, saved.nonce);
    }

    if (!profile.email) {
      throw new OidcError(
        "The provider did not return a verified email address.",
      );
    }

    const user = await users.ensureExternal({
      email: profile.email,
      name: profile.name,
      provider: provider.id,
    });
    return user;
  }

  async function exchangeCode(provider, { code, verifier, redirectUri }) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
    });
    if (provider.kind === "oidc") body.set("code_verifier", verifier);

    const response = await fetchImpl(provider.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new OidcError(
        payload.error_description || "The provider rejected the sign-in.",
      );
    }
    return payload;
  }

  async function oidcProfile(provider, tokens, expectedNonce) {
    if (tokens.id_token) {
      const claims = await verifyIdToken(
        provider,
        tokens.id_token,
        expectedNonce,
      );
      const email = claims.email || claims.preferred_username || claims.upn;
      if (email) return { email, name: claims.name };
    }

    if (provider.userInfoEndpoint && tokens.access_token) {
      const response = await fetchImpl(provider.userInfoEndpoint, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await response.json().catch(() => ({}));
      if (response.ok) {
        return {
          email: profile.email || profile.preferred_username,
          name: profile.name,
        };
      }
    }

    throw new OidcError("The provider did not return a profile.");
  }

  async function githubProfile(provider, accessToken) {
    if (!accessToken)
      throw new OidcError("GitHub did not return an access token.");
    const headers = {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "Comply",
    };
    const user = await fetchImpl(provider.userEndpoint, { headers }).then(
      (response) => (response.ok ? response.json() : {}),
    );

    let email = user.email;
    if (!email) {
      const emails = await fetchImpl(provider.emailsEndpoint, { headers }).then(
        (response) => (response.ok ? response.json() : []),
      );
      const preferred =
        emails.find((item) => item.primary && item.verified) ||
        emails.find((item) => item.verified);
      email = preferred?.email;
    }
    return { email, name: user.name || user.login };
  }

  async function verifyIdToken(provider, idToken, expectedNonce) {
    const [headerPart, payloadPart, signaturePart] = String(idToken).split(".");
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new OidcError("The provider returned an invalid identity token.");
    }

    const header = JSON.parse(
      Buffer.from(headerPart, "base64url").toString("utf8"),
    );
    if (header.alg !== "RS256") {
      throw new OidcError(
        "The provider used an unsupported signing algorithm.",
      );
    }

    const keys = await loadJwks(provider);
    const jwk = keys.find((item) => item.kid === header.kid) || keys[0];
    if (!jwk) throw new OidcError("The provider signing key is unavailable.");

    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(signaturePart, "base64url"),
    );
    if (!valid) throw new OidcError("The identity token signature is invalid.");

    const claims = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    );
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(provider.clientId)) {
      throw new OidcError(
        "The identity token was issued for another application.",
      );
    }
    if (claims.exp * 1000 < now()) {
      throw new OidcError("The identity token has expired.");
    }
    if (provider.issuer && claims.iss !== provider.issuer) {
      throw new OidcError("The identity token issuer does not match.");
    }
    if (expectedNonce && claims.nonce !== expectedNonce) {
      throw new OidcError("The identity token nonce does not match.");
    }
    return claims;
  }

  async function loadJwks(provider) {
    const cached = jwksCache.get(provider.id);
    if (cached && cached.expiresAt > now()) return cached.keys;

    const response = await fetchImpl(provider.jwksUri);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.keys)) {
      throw new OidcError("The provider signing keys could not be loaded.");
    }
    jwksCache.set(provider.id, {
      keys: payload.keys,
      expiresAt: now() + JWKS_TTL_MS,
    });
    return payload.keys;
  }

  return { begin, complete, publicList, providers };
}

export function providerErrorMessage(error) {
  const value = String(error);
  if (value === "access_denied") return "Sign-in was cancelled.";
  return "The provider could not complete the sign-in.";
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}
