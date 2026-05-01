// bini-server/src/index.ts

// ─── Force production mode ────────────────────────────────────────────────────
process.env.NODE_ENV = 'production';

// ─── Suppress dotenv/bini-env logs before ANY other import ───────────────────
;(function suppressDotenv() {
  const _log = console.log.bind(console);
  const _err = console.error.bind(console);
  const isDotenv = (...args: unknown[]) => {
    const msg = args.join(' ');
    return msg.includes('[dotenv@') || msg.includes('[bini-env] Loaded');
  };
  console.log = (...args: unknown[]) => { if (!isDotenv(...args)) _log(...args); };
  console.error = (...args: unknown[]) => { if (!isDotenv(...args)) _err(...args); };
})();

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import crypto from 'crypto';
import readline from 'readline';
import { exec } from 'child_process';
import { pathToFileURL } from 'url';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { loadEnv, detectEnvFiles } from 'bini-env';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORT    = parseInt(process.env.PORT                      ?? '3000', 10);
const BODY_TIMEOUT    = parseInt(process.env.BINI_BODY_TIMEOUT_SECS    ?? '30',   10) * 1000;
const HANDLER_TIMEOUT = parseInt(process.env.BINI_HANDLER_TIMEOUT_SECS ?? '30',   10) * 1000;
const BODY_SIZE_LIMIT = parseInt(process.env.BINI_BODY_SIZE_LIMIT      ?? String(10 * 1024 * 1024), 10);
const API_DIR         = path.join(process.cwd(), process.env.BINI_API_DIR  ?? 'src/app/api');
const DIST_DIR        = path.join(process.cwd(), process.env.BINI_DIST_DIR ?? 'dist');
const API_EXTS        = new Set(['.ts', '.js', '.mjs', '.cjs']);

// ─── ANSI colours ─────────────────────────────────────────────────────────────

const C = {
  CYAN:   '\x1b[36m',
  RESET:  '\x1b[0m',
  GREEN:  '\x1b[32m',
  RED:    '\x1b[31m',
  YELLOW: '\x1b[33m',
  BOLD:   '\x1b[1m',
  DIM:    '\x1b[2m',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiRoute {
  routePath: string;
  filePath: string;
}

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
) => void | Promise<void>;

// ─── Network ──────────────────────────────────────────────────────────────────

function getNetworkIp(): string | null {
  const ifaces = os.networkInterfaces();
  const SKIP = /docker|veth|br-|lo|loopback|vmnet|vbox|utun|tun|tap/i;

  for (const name in ifaces) {
    if (SKIP.test(name)) continue;
    for (const iface of ifaces[name] ?? []) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      const [a, b] = iface.address.split('.').map(Number);
      if (a === 169 && b === 254) continue; // skip APIPA
      const isPrivate = a === 10
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
      if (isPrivate) return iface.address; // first private LAN wins
    }
  }

  // Fallback: first non-loopback IPv4
  for (const name in ifaces) {
    if (SKIP.test(name)) continue;
    for (const iface of ifaces[name] ?? []) {
      if (!iface.internal && iface.family === 'IPv4') return iface.address;
    }
  }

  return null;
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(port: number): void {
  const envFiles  = detectEnvFiles(process.cwd()).map((f: { name: string }) => f.name);
  const networkIp = getNetworkIp();

  console.log(`\n  ${C.BOLD}${C.CYAN}ß Bini.js${C.RESET}  (production)`);

  if (envFiles.length > 0) {
    console.log(`  ${C.GREEN}➜${C.RESET}  Environments: ${envFiles.join(', ')}`);
  }

  console.log(`  ${C.GREEN}➜${C.RESET}  Local:   ${C.CYAN}http://localhost:${port}/${C.RESET}`);

  if (networkIp) {
    console.log(`  ${C.GREEN}➜${C.RESET}  Network: ${C.CYAN}http://${networkIp}:${port}/${C.RESET}`);
  }

  console.log(`  ${C.GREEN}➜${C.RESET}  ${C.DIM}press ${C.RESET}h${C.DIM} + ${C.RESET}enter${C.DIM} to show help${C.RESET}`);
  console.log('');
}

// ─── Port helpers ─────────────────────────────────────────────────────────────

async function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortFree(port)) {
      if (port !== start) {
        console.log(`\n  ${C.YELLOW}⚠${C.RESET}  Port ${start} in use — using ${port} instead.`);
      }
      return port;
    }
  }
  throw new Error(`No free port found in range ${start}–${start + 99}`);
}

// ─── Interactive keyboard loop ────────────────────────────────────────────────

function startKeyboardLoop(port: number): void {
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    switch (line.trim()) {
      case 'h':
        console.log('');
        console.log('  Shortcuts');
        console.log(`  ${C.DIM}press ${C.RESET}o${C.DIM} + ${C.RESET}enter${C.DIM} to open in browser${C.RESET}`);
        console.log(`  ${C.DIM}press ${C.RESET}q${C.DIM} + ${C.RESET}enter${C.DIM} to quit${C.RESET}`);
        console.log('');
        break;
      case 'o': {
        const url = `http://localhost:${port}/`;
        const cmd = process.platform === 'win32'  ? `start ${url}`
                  : process.platform === 'darwin' ? `open ${url}`
                  : `xdg-open ${url}`;
        exec(cmd);
        break;
      }
      case 'q':
        process.exit(0);
    }
  });

  rl.on('close', () => process.exit(0));
}

// ─── API Route Scanner ────────────────────────────────────────────────────────

function scanApiRoutes(dir: string, baseRoute = '', depth = 0): ApiRoute[] {
  const routes: ApiRoute[] = [];
  if (depth > 100 || !fs.existsSync(dir)) return routes;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return routes;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const isCatchAll = entry.name.startsWith('[...') && entry.name.endsWith(']');
      const isDynamic  = entry.name.startsWith('[')    && entry.name.endsWith(']');
      const segment    = isCatchAll ? '*' : isDynamic ? `:${entry.name.slice(1, -1)}` : entry.name;
      routes.push(...scanApiRoutes(fullPath, `${baseRoute}/${segment}`, depth + 1));
      continue;
    }

    const ext  = path.extname(entry.name);
    const base = path.basename(entry.name, ext);
    if (!API_EXTS.has(ext)) continue;

    const isCatchAll = base.startsWith('[...') && base.endsWith(']');
    const isDynamic  = base.startsWith('[')    && base.endsWith(']');

    let routePath: string;
    if (isCatchAll)            routePath = `${baseRoute}/*`;
    else if (base === 'index') routePath = baseRoute || '/';
    else if (isDynamic)        routePath = `${baseRoute}/:${base.slice(1, -1)}`;
    else                       routePath = `${baseRoute}/${base}`;

    routes.push({ routePath: `/api${routePath}`, filePath: fullPath });
  }

  return routes;
}

function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const patParts = pattern.split('/').filter(Boolean);
  const urlParts = pathname.split('/').filter(Boolean);

  const isCatchAll = patParts[patParts.length - 1] === '*';
  if (isCatchAll) {
    const prefix = patParts.slice(0, -1);
    if (urlParts.length < prefix.length) return null;
    for (let i = 0; i < prefix.length; i++) {
      if (!prefix[i].startsWith(':') && prefix[i] !== urlParts[i]) return null;
    }
    return { '*': urlParts.slice(prefix.length).join('/') };
  }

  if (patParts.length !== urlParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      const value = decodeURIComponent(urlParts[i]);
      if (value.includes('..') || value.includes('//')) return null;
      params[patParts[i].slice(1)] = value;
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

// ─── Module cache ─────────────────────────────────────────────────────────────

const moduleCache = new Map<string, { mtime: number; handler: unknown }>();

async function importHandler(filePath: string): Promise<unknown> {
  let mtime = 0;
  try {
    mtime = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }

  const cached = moduleCache.get(filePath);
  if (cached?.mtime === mtime) return cached.handler;

  try {
    const mod     = await import(pathToFileURL(filePath).href + '?t=' + mtime);
    const handler = mod.default ?? null;
    moduleCache.set(filePath, { mtime, handler });
    return handler;
  } catch (e: any) {
    console.error(`[bini-api] import error: ${filePath}`, e?.message);
    moduleCache.delete(filePath);
    return null;
  }
}

// ─── Body reader ──────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Request body timeout'));
    }, BODY_TIMEOUT);

    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > BODY_SIZE_LIMIT) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end',   () => { clearTimeout(timer); resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined); });
    req.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

function normalizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v)
      ? (k.toLowerCase() === 'cookie' ? v.join('; ') : v.join(', '))
      : v;
  }
  return out;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Request-ID',
  'Vary': 'Origin',
};

// ─── API handler ──────────────────────────────────────────────────────────────

let routeCache: ApiRoute[] | null = null;

async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' });
    res.end();
    return;
  }

  routeCache ??= scanApiRoutes(API_DIR);

  const host   = req.headers.host ?? 'localhost';
  const rawUrl = `http://${host}${req.url ?? '/'}`;
  const method = (req.method ?? 'GET').toUpperCase();

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request URL' }));
    return;
  }

  const { pathname, search } = parsedUrl;

  let matchedRoute: ApiRoute | null = null;
  let params: Record<string, string> | null = null;
  for (const route of routeCache) {
    params = matchRoute(route.routePath, pathname);
    if (params !== null) { matchedRoute = route; break; }
  }

  if (!matchedRoute) {
    res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: `No API handler for ${pathname}` }));
    return;
  }

  let body: Buffer | undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    try {
      body = await readBody(req);
    } catch (e: any) {
      const status = e.message.includes('too large') ? 413 : 408;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  const handler = await importHandler(matchedRoute.filePath);
  if (!handler) {
    res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: 'Failed to load handler' }));
    return;
  }

  const normalizedHeaders = normalizeHeaders(req.headers);

  let webRes: Response;
  try {
    if (typeof (handler as any).fetch === 'function') {
      // Hono app — strip /api prefix so Hono sees clean paths
      const honoUrl = `http://${host}${pathname.replace(/^\/api/, '') || '/'}${search}`;
      webRes = await (handler as any).fetch(new Request(honoUrl, {
        method,
        headers: normalizedHeaders,
        body: body ? new Uint8Array(body) : null,
      }));

    } else if (typeof handler === 'function') {
      const reqWithParams = new Request(rawUrl, {
        method,
        headers: { ...normalizedHeaders, 'x-bini-params': JSON.stringify(params ?? {}) },
        body: body ? new Uint8Array(body) : null,
      });

      const result = await Promise.race([
        (handler as Function)(reqWithParams),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Handler timeout')), HANDLER_TIMEOUT),
        ),
      ]);

      webRes = result instanceof Response
        ? result
        : new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });

    } else {
      res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'Handler has no valid default export' }));
      return;
    }
  } catch (e: any) {
    console.error('[bini-api] handler error:', e?.message ?? e);
    res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: e?.message ?? 'Internal server error' }));
    return;
  }

  const finalHeaders: Record<string, string> = { ...CORS_HEADERS };
  webRes.headers.forEach((v, k) => { finalHeaders[k] = v; });
  res.writeHead(webRes.status, finalHeaders);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

// ─── Static file server ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript',
  '.mjs':         'application/javascript',
  '.css':         'text/css',
  '.json':        'application/json',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.jpeg':        'image/jpeg',
  '.gif':         'image/gif',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.webp':        'image/webp',
  '.avif':        'image/avif',
  '.woff':        'font/woff',
  '.woff2':       'font/woff2',
  '.ttf':         'font/ttf',
  '.eot':         'application/vnd.ms-fontobject',
  '.txt':         'text/plain',
  '.xml':         'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.map':         'application/json',
};

function getETag(stat: fs.Stats): string {
  return crypto
    .createHash('md5')
    .update(`${stat.size}-${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
}

async function sendFile(
  filePath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const ext      = path.extname(filePath).toLowerCase();
  const mimeType = MIME[ext] ?? 'application/octet-stream';
  const isAsset  = filePath.includes(`${path.sep}assets${path.sep}`);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const etag = getETag(stat);
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type':   mimeType,
    'Content-Length': stat.size,
    'Cache-Control':  isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'ETag':           etag,
    'X-Powered-By':   'Bini.js',
  });

  if (req.method === 'HEAD') { res.end(); return; }

  try {
    await pipeline(createReadStream(filePath), res);
  } catch {
    // Client disconnected mid-stream — ignore
  }
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname.startsWith('/api')) return next();

  const filePath = path.join(DIST_DIR, pathname);

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile()) { await sendFile(filePath, req, res); return; }
  } catch { /* fall through */ }

  const indexPath = path.join(DIST_DIR, 'index.html');
  try {
    await fs.promises.access(indexPath);
    await sendFile(indexPath, req, res);
  } catch {
    next();
  }
}

// ─── Middleware composer ──────────────────────────────────────────────────────

function compose(middlewares: Middleware[]) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx >= middlewares.length) return;
      const fn = middlewares[idx++];
      try {
        await fn(req, res, next);
      } catch (e: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e?.message ?? 'Internal Server Error' }));
        }
      }
    };
    await next();
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────

export async function start(): Promise<void> {
  await loadEnv(process.cwd());

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`\n  ${C.RED}✗${C.RESET}  dist/ not found at ${DIST_DIR}.\n      Run ${C.CYAN}npm run build${C.RESET} first.\n`);
    process.exit(1);
  }

  const port = await findFreePort(DEFAULT_PORT);

  const handler = compose([
    async (req, res, next) => {
      if (!req.url?.startsWith('/api')) return next();
      await handleApiRequest(req, res, next);
    },
    serveStatic,
    (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    },
  ]);

  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'keep-alive');
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout   = 66_000;

  startKeyboardLoop(port);

  server.listen(port, '0.0.0.0', () => {
    printBanner(port);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}