import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import {
  AgentError,
  AgentRegistry,
  MCP_TOOLS,
  mcpServerInfo,
} from "./agent.mjs";
import { createAuth } from "./auth.mjs";
import {
  INGESTABLE_FRAMEWORKS,
  SOURCE_REGISTRY,
  runIngest,
} from "./ingest/index.mjs";
import { McpKeyRegistry } from "./keys.mjs";
import { createStaticHandler } from "./static.mjs";

const JSON_LIMIT = 4 * 1024 * 1024;
const LOG_LIMIT = 200;
const DEFAULT_INTERVAL_HOURS = 168;
const DEFAULT_STARTUP_DELAY_SECONDS = 30;

export function createApiServer({
  store,
  auth = createAuth(),
  users = null,
  oidc = null,
  demoLogin = null,
  now = () => new Date(),
  agentDataFile = null,
  mcpKeysDataFile = null,
  staticRoot = null,
  dev = process.env.COMPLY_DEV_LINKS === "1" ||
    process.env.NODE_ENV !== "production",
  ingestSchedule = {
    intervalHours: Number(
      process.env.COMPLY_INGEST_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS,
    ),
    startupDelaySeconds: Number(
      process.env.COMPLY_INGEST_STARTUP_DELAY_SECONDS ??
        DEFAULT_STARTUP_DELAY_SECONDS,
    ),
    onStart: process.env.COMPLY_INGEST_ON_START !== "0",
  },
} = {}) {
  if (!store) throw new Error("A content store is required.");

  const agents = new AgentRegistry({ store, now, dataFile: agentDataFile });
  const keys = new McpKeyRegistry({ dataFile: mcpKeysDataFile, now });
  const ready = Promise.all([agents.init(), keys.init()]);
  const jobs = new Map();
  let setupInProgress = false;
  const intervalMs = normalizeIntervalMs(ingestSchedule.intervalHours);
  const startupDelayMs =
    Math.max(0, Number(ingestSchedule.startupDelaySeconds) || 0) * 1000;
  const schedule = {
    enabled: intervalMs > 0,
    intervalHours: intervalMs / 3_600_000,
    lastRunAt: null,
    lastFinishedAt: null,
    lastTrigger: null,
    lastStatus: null,
    lastError: null,
    lastResult: null,
    nextRunAt: null,
  };
  let scheduleTimer = null;

  function recordRun(job, trigger) {
    schedule.lastRunAt = job.startedAt;
    schedule.lastFinishedAt = job.finishedAt;
    schedule.lastTrigger = trigger;
    schedule.lastStatus = job.status;
    schedule.lastError = job.error;
    schedule.lastResult = job.result;
  }

  function planRun(delayMs, trigger) {
    if (!schedule.enabled) return;
    schedule.nextRunAt = new Date(now().getTime() + delayMs).toISOString();
    scheduleTimer = setTimeout(() => {
      scheduleTimer = null;
      void executeScheduledRun(trigger);
    }, delayMs);
    scheduleTimer.unref?.();
  }

  async function executeScheduledRun(trigger) {
    schedule.nextRunAt = null;
    try {
      const job = startIngest("all", trigger);
      await job.done;
    } catch (error) {
      schedule.lastError =
        error instanceof Error ? error.message : String(error);
      schedule.lastStatus = "failed";
    } finally {
      if (schedule.enabled) planRun(intervalMs, "interval");
    }
  }

  function activeJob() {
    return [...jobs.values()].find((job) => job.status === "running") ?? null;
  }

  function startIngest(requested, trigger = "manual") {
    const list =
      requested === "all"
        ? INGESTABLE_FRAMEWORKS
        : INGESTABLE_FRAMEWORKS.filter((item) => item === requested);
    if (list.length === 0)
      throw new Error(`Framework ${requested} has no downloadable document.`);

    const active = [...jobs.values()].find(
      (job) =>
        job.status === "running" &&
        job.frameworks.some((item) => list.includes(item)),
    );
    if (active) return active;

    const job = {
      id: randomUUID(),
      framework: requested,
      frameworks: list,
      status: "running",
      startedAt: now().toISOString(),
      finishedAt: null,
      logs: [],
      result: null,
      error: null,
    };
    jobs.set(job.id, job);

    const done = (async () => {
      try {
        const results = [];
        for (const item of list) {
          const result = await runIngest(item, {
            log: (message) => pushLog(job, message),
          });
          await store.applyIngest(result);
          results.push({
            framework: item,
            sourceId: result.source.id,
            requirements: result.requirements.length,
            pages: result.document.pages.length,
          });
          pushLog(
            job,
            `${item}: saved ${result.requirements.length} requirements.`,
          );
        }
        job.status = "succeeded";
        job.result = results;
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        pushLog(job, `failed: ${job.error}`);
      } finally {
        job.finishedAt = now().toISOString();
        recordRun(job, trigger);
      }
    })();
    Object.defineProperty(job, "done", {
      value: done,
      enumerable: false,
    });

    return job;
  }

  const serveStatic = createStaticHandler(staticRoot);

  async function dispatch(request, url) {
    const method = request.method ?? "GET";
    await ready;

    if (method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(request), body: "" };
    }

    try {
      const result = await route(request, url);
      if (result === undefined) {
        const asset = await serveStatic?.(url.pathname, method);
        return asset
          ? finishResponse(request, asset)
          : jsonResponse(request, 404, { error: "Not found." });
      }
      return finishResponse(request, result);
    } catch (error) {
      const status = error.status ?? (error instanceof AgentError ? 400 : 500);
      if (status >= 500) console.error(error);
      return jsonResponse(request, status, {
        error: error instanceof Error ? error.message : "Unexpected error.",
        ...(error instanceof AgentError ? { code: error.code } : {}),
      });
    }
  }

  const server = createServer(async (request, response) => {
    const started = Date.now();
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const bodyText = await readRawBody(request).catch((error) => {
      response.writeHead(error.status ?? 400).end();
      return null;
    });
    if (bodyText === null) return;

    const result = await dispatch(
      {
        method: request.method,
        url: request.url,
        headers: request.headers,
        bodyText,
      },
      url,
    );

    response.writeHead(result.status, result.headers);
    response.end(result.body);

    if (dev) {
      const elapsed = Date.now() - started;
      if (elapsed > 500)
        console.log(`${request.method} ${url.pathname} ${elapsed}ms`);
    }
  });

  async function route(request, url) {
    await ready;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method ?? "GET";

    if (path === "/healthz" && method === "GET") {
      return { body: { status: "ok", time: now().toISOString() } };
    }

    if (path === "/api/runtime" && method === "GET") {
      return {
        body: {
          deployment:
            process.env.COMPLY_DEPLOYMENT_MODE ??
            (process.env.COMPLY_TRUST_HOST ? "self_hosted" : "managed"),
          publicUrl: publicOrigin(request),
          trust: {
            host: process.env.COMPLY_TRUST_HOST ?? null,
            slug: process.env.COMPLY_TRUST_SLUG ?? null,
            managedHost: "edge.comply.app",
          },
          passwordLogin: Boolean(users),
          providers: oidc?.publicList() ?? [],
          setupRequired: Boolean(users) && users.list().length === 0,
        },
      };
    }

    // On a self-hosted trust hostname, the root opens the public trust page.
    const trustHost = process.env.COMPLY_TRUST_HOST;
    if (
      trustHost &&
      path === "/" &&
      hostname(request) === trustHost.toLowerCase()
    ) {
      const slug = process.env.COMPLY_TRUST_SLUG ?? "nordwind";
      return {
        status: 302,
        headers: { location: `/t/${encodeURIComponent(slug)}` },
        body: undefined,
      };
    }

    if (path === "/mcp" && method === "POST") {
      const tenantId = await mcpTenant(request, dev, keys);
      const body = await readBody(request);
      const reply = mcpReply(body, tenantId, agents);
      return reply === null
        ? { status: 204, body: undefined }
        : { body: reply };
    }

    if (path === "/mcp" && method === "GET") {
      return {
        status: 405,
        headers: { allow: "POST" },
        body: { error: "Use POST with a JSON-RPC request." },
      };
    }

    if (path === "/api/access/keys" && method === "GET") {
      return { body: { keys: keys.list(apiTenant(request)) } };
    }

    if (path === "/api/access/keys" && method === "POST") {
      const body = await readBody(request);
      return {
        status: 201,
        body: keys.create(apiTenant(request), {
          name: body.name,
          scopes: body.scopes,
        }),
      };
    }

    const keyMatch = /^\/api\/access\/keys\/([A-Za-z0-9-]+)$/.exec(path);
    if (keyMatch && method === "DELETE") {
      keys.revoke(apiTenant(request), keyMatch[1]);
      return { status: 204, body: undefined };
    }

    if (path === "/api/agent/assessments" && method === "GET") {
      return { body: { assessments: agents.list(apiTenant(request)) } };
    }

    if (path === "/api/agent/boards" && method === "GET") {
      return { body: { boards: agents.list(apiTenant(request)) } };
    }

    const agentBoardMatch = /^\/api\/agent\/boards\/([A-Za-z0-9-]+)$/.exec(
      path,
    );
    if (agentBoardMatch && method === "GET") {
      const assessment = agents.detail(apiTenant(request), agentBoardMatch[1]);
      return { body: { assessment } };
    }

    const agentMatch = /^\/api\/agent\/assessments\/([A-Za-z0-9-]+)$/.exec(
      path,
    );
    if (agentMatch && method === "GET") {
      return { body: agents.detail(apiTenant(request), agentMatch[1]) };
    }

    if (path === "/api/library" && method === "GET") {
      return { body: filterLibrary(store.snapshot(), url.searchParams) };
    }

    if (path === "/api/frameworks" && method === "GET") {
      return { body: { frameworks: frameworkSummary(store.snapshot()) } };
    }

    if (path === "/api/documents" && method === "GET") {
      return { body: { documents: store.snapshot().documents } };
    }

    const documentMatch = /^\/api\/documents\/([A-Za-z0-9._-]+)$/.exec(path);
    if (documentMatch && method === "GET") {
      const document = await store.getDocument(documentMatch[1]);
      if (!document)
        return { status: 404, body: { error: "Document not found." } };
      return { body: { document } };
    }

    if (path === "/api/ingest" && method === "GET") {
      return { body: { jobs: [...jobs.values()].sort(byStartedDesc) } };
    }

    if (path === "/api/ingest/schedule" && method === "GET") {
      const running = activeJob();
      return {
        body: {
          schedule: {
            ...schedule,
            running: running
              ? {
                  id: running.id,
                  framework: running.framework,
                  startedAt: running.startedAt,
                }
              : null,
          },
        },
      };
    }

    if (path === "/api/ingest" && method === "POST") {
      const body = await readBody(request);
      const framework = String(body.framework ?? "all");
      if (framework !== "all" && !INGESTABLE_FRAMEWORKS.includes(framework)) {
        return {
          status: 400,
          body: { error: `Unknown framework: ${framework}.` },
        };
      }
      const job = startIngest(framework);
      return { status: 202, body: { job } };
    }

    const jobMatch = /^\/api\/ingest\/([a-f0-9-]+)$/.exec(path);
    if (jobMatch && method === "GET") {
      const job = jobs.get(jobMatch[1]);
      if (!job) return { status: 404, body: { error: "Job not found." } };
      return { body: { job } };
    }

    if (path === "/api/auth/magic-link" && method === "POST") {
      const body = await readBody(request);
      const link = withBadRequest(() => auth.requestMagicLink(body.email));
      const appUrl = process.env.COMPLY_APP_URL ?? "http://localhost:4200";
      const signInUrl = `${appUrl.replace(/\/$/, "")}/sign-in?token=${encodeURIComponent(link.token)}`;

      if (dev) {
        console.log(`Magic link for ${link.email}: ${signInUrl}`);
      } else {
        const webhook = process.env.COMPLY_MAIL_WEBHOOK_URL;
        if (!webhook) {
          return {
            status: 503,
            body: {
              error: "Email delivery is not configured for this deployment.",
            },
          };
        }
        const delivered = await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: link.email,
            url: signInUrl,
            expiresAt: link.expiresAt,
          }),
        }).catch(() => null);
        if (!delivered?.ok) {
          return {
            status: 502,
            body: { error: "The sign-in email could not be sent." },
          };
        }
      }

      return {
        status: 201,
        body: {
          sent: true,
          email: link.email,
          expiresAt: link.expiresAt,
          ...(dev ? { devToken: link.token } : {}),
        },
      };
    }

    if (path === "/api/auth/verify" && method === "POST") {
      const body = await readBody(request);
      return { body: withBadRequest(() => auth.verifyMagicLink(body.token)) };
    }

    if (path === "/api/auth/providers" && method === "GET") {
      return {
        body: {
          password: Boolean(users),
          providers: oidc?.publicList() ?? [],
          demo: demoLogin,
          setupRequired: Boolean(users) && users.list().length === 0,
        },
      };
    }

    // The first account owns the installation. Later accounts are members.
    if (path === "/api/auth/register" && method === "POST") {
      if (!users) {
        return {
          status: 404,
          body: { error: "Password sign-in is not configured." },
        };
      }
      if (users.list().length > 0) {
        return {
          status: 403,
          body: { error: "Setup is already complete. Ask an administrator for an account." },
        };
      }
      if (setupInProgress) {
        return {
          status: 409,
          body: { error: "Another setup request is in progress." },
        };
      }

      setupInProgress = true;
      try {
        const body = await readBody(request);
        if (users.list().length > 0) {
          return {
            status: 403,
            body: { error: "Setup is already complete. Ask an administrator for an account." },
          };
        }
        const user = await users.create({
          email: body.email,
          name: body.name,
          password: body.password,
          organizationName:
            String(body.organizationName ?? "").trim() || "Organization",
        });
        return { status: 201, body: auth.sessionFor(user) };
      } finally {
        setupInProgress = false;
      }
    }

    if (path === "/api/auth/login" && method === "POST") {
      const body = await readBody(request);
      return { body: await auth.login(body.email, body.password) };
    }

    if (path === "/api/auth/exchange" && method === "POST") {
      const body = await readBody(request);
      return { body: await auth.exchangeCode(body.code) };
    }

    const oidcMatch =
      /^\/api\/auth\/oidc\/([a-z0-9-]+)\/(start|callback)$/.exec(path);
    if (oidcMatch && method === "GET") {
      if (!oidc) {
        return {
          status: 404,
          body: { error: "OIDC sign-in is not configured." },
        };
      }
      const [, providerId, action] = oidcMatch;
      const origin = publicOrigin(request);
      const appUrl = (process.env.COMPLY_APP_URL ?? origin).replace(/\/$/, "");

      if (action === "start") {
        return {
          status: 302,
          headers: { location: oidc.begin(providerId, origin) },
          body: undefined,
        };
      }

      try {
        const user = await oidc.complete(providerId, {
          code: url.searchParams.get("code"),
          state: url.searchParams.get("state"),
          error: url.searchParams.get("error"),
          origin,
        });
        const code = auth.issueCode(user);
        return {
          status: 302,
          headers: {
            location: `${appUrl}/sign-in?code=${encodeURIComponent(code)}`,
          },
          body: undefined,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Sign-in failed.";
        return {
          status: 302,
          headers: {
            location: `${appUrl}/sign-in?error=${encodeURIComponent(message)}`,
          },
          body: undefined,
        };
      }
    }

    if (path === "/api/auth/me" && method === "GET") {
      const session = auth.session(bearer(request));
      if (!session) return { status: 401, body: { error: "Not signed in." } };
      return { body: { user: auth.userFor(session.email) } };
    }

    if (path === "/api/auth/sign-out" && method === "POST") {
      return { status: 204, body: undefined };
    }

    return undefined;
  }

  if (schedule.enabled) {
    const delayMs = ingestSchedule.onStart ? startupDelayMs : intervalMs;
    planRun(delayMs, ingestSchedule.onStart ? "startup" : "interval");
    if (dev) {
      console.log(
        `Content refresh scheduled every ${schedule.intervalHours}h; next run ${schedule.nextRunAt}.`,
      );
    }
  }

  server.on("close", () => {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = null;
    schedule.nextRunAt = null;
    jobs.clear();
    void agents.flush();
    void keys.flush();
  });

  return {
    server,
    ready,
    jobs,
    schedule,
    startIngest,
    agents,
    keys,
    users,
    oidc,
    async handle({ method = "GET", url = "/", headers = {}, bodyText = "" }) {
      const target = new URL(url, `http://${headers.host ?? "localhost"}`);
      return dispatch({ method, url, headers, bodyText }, target);
    },
  };
}

function normalizeIntervalMs(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(60_000, value * 3_600_000);
}

function pushLog(job, message) {
  job.logs.push({ at: new Date().toISOString(), message });
  if (job.logs.length > LOG_LIMIT)
    job.logs.splice(0, job.logs.length - LOG_LIMIT);
}

function byStartedDesc(left, right) {
  return String(right.startedAt).localeCompare(String(left.startedAt));
}

function bearer(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function hostname(request) {
  return String(
    request.headers["x-forwarded-host"] ?? request.headers.host ?? "",
  )
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

function publicOrigin(request) {
  const configured = process.env.COMPLY_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] ?? "http";
  const host =
    request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

function apiTenant(request) {
  const header = String(request.headers["x-comply-tenant"] ?? "").trim();
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(header) ? header : "nordwind";
}

async function mcpTenant(request, dev, keys) {
  const token = bearer(request);
  const record = await keys.authenticate(token);
  if (record) {
    const header = String(request.headers["x-comply-tenant"] ?? "").trim();
    if (header && header !== record.tenantId) {
      const error = new Error(
        "The tenant header does not match the tenant in the MCP key.",
      );
      error.status = 403;
      throw error;
    }
    return record.tenantId;
  }

  if (dev) return apiTenant(request);

  const error = new Error("Connect with a valid MCP API key.");
  error.status = 401;
  throw error;
}

function mcpReply(body, tenantId, agents) {
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32600, message: "Invalid Request" },
    };
  }

  if (body.method.startsWith("notifications/")) return null;
  const id = body.id ?? null;

  if (body.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: mcpServerInfo(),
        instructions: mcpServerInfo().instructions,
      },
    };
  }

  if (body.method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (body.method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }

  if (body.method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }

  if (body.method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
  }

  if (body.method === "tools/call") {
    const name = String(body.params?.name ?? "");
    if (!MCP_TOOLS.some((tool) => tool.name === name)) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown tool: ${name}.` },
      };
    }
    try {
      const result = agents.call(tenantId, name, body.params?.arguments ?? {});
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        },
      };
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? {
              code: error.code,
              message: error.message,
              details: error.details,
            }
          : {
              code: "unexpected_error",
              message: error instanceof Error ? error.message : String(error),
            };
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `${failure.message}\n\n${JSON.stringify(failure, null, 2)}`,
            },
          ],
          structuredContent: { error: failure },
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${body.method}.` },
  };
}

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers.origin ?? "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,authorization,accept,mcp-protocol-version,mcp-session-id,x-comply-tenant",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function finishResponse(request, result) {
  const status = result.status ?? 200;
  const headers = { ...corsHeaders(request), ...(result.headers ?? {}) };
  if (status === 204 || result.body === undefined) {
    return { status, headers, body: "" };
  }
  if (typeof result.body === "string" || Buffer.isBuffer(result.body)) {
    return { status, headers, body: result.body };
  }
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
    body: JSON.stringify(result.body),
  };
}

function jsonResponse(request, status, body, headers = {}) {
  return finishResponse(request, { status, body, headers });
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBody(request) {
  if (typeof request.bodyText === "string") return parseJson(request.bodyText);
  return parseJson(await readRawBody(request));
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function filterLibrary(library, params) {
  const hasQuery = ["framework", "status", "q", "page", "pageSize"].some(
    (key) => params.has(key),
  );
  if (!hasQuery) {
    return {
      ...library,
      total: library.requirements.length,
      page: 1,
      pageSize: library.requirements.length,
    };
  }

  const framework = params.get("framework");
  const status = params.get("status");
  const query = (params.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    500,
    Math.max(1, Number.parseInt(params.get("pageSize") ?? "50", 10) || 50),
  );

  let sources = library.sources;
  let requirements = library.requirements;

  if (framework)
    sources = sources.filter((item) => item.frameworkId === framework);
  if (framework)
    requirements = requirements.filter(
      (item) => item.frameworkId === framework,
    );
  if (status)
    requirements = requirements.filter((item) => item.status === status);
  if (query) {
    requirements = requirements.filter((item) =>
      [item.ref, item.title, item.text].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }

  const total = requirements.length;
  const paged = requirements.slice((page - 1) * pageSize, page * pageSize);

  return {
    ...library,
    sources,
    requirements: paged,
    total,
    page,
    pageSize,
  };
}

function frameworkSummary(library) {
  return SOURCE_REGISTRY.map((registry) => {
    const source = library.sources.find(
      (item) => item.frameworkId === registry.frameworkId,
    );
    const requirements = source
      ? library.requirements.filter((item) => item.sourceId === source.id)
      : [];
    return {
      ...registry,
      sourceId: source?.id ?? null,
      requirements: requirements.length,
      published: requirements.filter((item) => item.status === "published")
        .length,
      documents: library.documents.filter(
        (item) => item.frameworkId === registry.frameworkId,
      ).length,
      lastFetchedAt:
        library.documents.find(
          (item) => item.frameworkId === registry.frameworkId,
        )?.fetchedAt ?? null,
    };
  });
}

function withBadRequest(task) {
  try {
    return task();
  } catch (error) {
    if (error instanceof Error) error.status ??= 400;
    throw error;
  }
}
