import { app } from "@azure/functions";
import { join } from "node:path";

import { createApp } from "../../server/server.mjs";

let application;

async function runtime() {
  if (!application) {
    application = await createApp({
      dataDir:
        process.env.COMPLY_DATA_DIR ||
        (process.env.WEBSITE_SITE_NAME
          ? "/home/data"
          : join(process.cwd(), "data")),
      webRoot: process.env.COMPLY_WEB_ROOT || join(process.cwd(), "web"),
    });
  }
  return application;
}

/**
 * One catch-all function serves the Angular build, /api, /mcp, and /healthz.
 * The upstream platform terminates TLS and forwards the original host headers.
 */
app.http("comply", {
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*path}",
  handler: async (request, context) => {
    const instance = await runtime();
    const headers = Object.fromEntries(request.headers);
    const bodyText =
      request.method === "GET" || request.method === "HEAD"
        ? ""
        : await request.text();

    const result = await instance.handle({
      method: request.method,
      url: request.url,
      headers,
      bodyText,
    });

    if (result.status >= 500) {
      context.error(`Comply request failed: ${request.method} ${request.url}`);
    }
    return {
      status: result.status,
      headers: result.headers,
      body: Buffer.isBuffer(result.body)
        ? new Uint8Array(result.body)
        : result.body,
    };
  },
});
