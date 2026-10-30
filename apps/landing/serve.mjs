#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 3100);

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const PAGES = new Set(['pricing', 'privacy', 'terms', 'support']);

function page(pathname) {
  if (pathname === '/') return 'index.html';
  if (PAGES.has(pathname.slice(1))) return pathname.slice(1) + '.html';
  return pathname.slice(1);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  const relative = normalize(page(pathname)).replace(/^([/\\])+/, '');
  if (relative.startsWith('..') || relative.includes('..' + sep)) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  const file = resolve(join(root, relative));
  if (!file.startsWith(root + sep) && file !== root) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }

  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const body = await readFile(file);
  response.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(body.length),
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Comply marketing site on http://127.0.0.1:${port}`);
});
