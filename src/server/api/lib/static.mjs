import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/**
 * Serves the Angular build from the same process as the API. Unknown paths
 * without an extension fall back to index.html so client routes survive a
 * reload; missing assets stay 404.
 */
export function createStaticHandler(root) {
  if (!root) return null;
  const base = resolve(root);

  return async function serveStatic(pathname, method = "GET") {
    if (method !== "GET" && method !== "HEAD") return null;
    if (pathname === "/api" || pathname.startsWith("/api/")) return null;
    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) return null;

    let path;
    try {
      path = decodeURIComponent(pathname);
    } catch {
      return { status: 400, headers: {}, body: "" };
    }

    const relative = normalize(path).replace(/^([/\\])+/, "");
    if (relative.startsWith("..") || relative.includes(`..${sep}`)) {
      return { status: 400, headers: {}, body: "" };
    }

    let file = resolve(base, relative || "index.html");
    if (!file.startsWith(base)) {
      return { status: 400, headers: {}, body: "" };
    }

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file).catch(() => null);
    }

    if (!info?.isFile()) {
      if (extname(pathname)) return null;
      file = join(base, "index.html");
      info = await stat(file).catch(() => null);
      if (!info?.isFile()) return null;
    }

    const content = await readFile(file);
    const body = method === "HEAD" ? Buffer.alloc(0) : content;
    const extension = extname(file).toLowerCase();
    const immutable = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(file);

    return {
      status: 200,
      headers: {
        "content-type": MIME[extension] ?? "application/octet-stream",
        "content-length": String(content.length),
        "cache-control": immutable
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        ...SECURITY_HEADERS,
      },
      body,
    };
  };
}
