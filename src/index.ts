// bini-server/src/index.ts

import http from 'http';
import fs, { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import crypto from 'crypto';
import readline from 'readline';
import { exec } from 'child_process';
import { pathToFileURL } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { loadEnvFiles, envFilesFor } from 'bini-env/node';

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
) => void | Promise<void>;

type ApiFetch = (
  request: Request,
  env?: Record<string, unknown>,
  ctx?: { waitUntil(p: Promise<unknown>): void },
) => Promise<Response>;

// ─── Env ─────────────────────────────────────────────────────────────────────

function getEnvVar(key: string, defaultValue?: string): string | undefined {
  return process.env[`BINI_${key}`]
    ?? process.env[`VITE_${key}`]
    ?? process.env[key]
    ?? defaultValue;
}

function getEnvVarNumber(key: string, defaultValue: number): number {
  const raw = getEnvVar(key);
  if (raw === undefined) return defaultValue;
  const n = parseInt(raw, 10);
  return isNaN(n) ? defaultValue : n;
}

// ─── Config ──────────────────────────────────────────────────────────────────

interface Config {
  defaultPort: number;
  bodyTimeout: number;
  handlerTimeout: number;
  bodySizeLimit: number;
  distDir: string;
  compiledApiDir: string;
  apiDir: string;
  apiEntry: string;
  base: string;
  isProd: boolean;
}

function readConfig(): Config {
  const distDir = path.join(process.cwd(), getEnvVar('DIST_DIR') ?? 'dist');
  const apiDir = path.join(distDir, 'api');
  const rawBase = (getEnvVar('BASE') ?? '').trim();
  const base =
    !rawBase || rawBase === '/' || rawBase === '.' || rawBase === './'
      ? ''
      : '/' + rawBase.replace(/^\/+|\/+$/g, '');

  return {
    defaultPort: getEnvVarNumber('PORT', 3000),
    bodyTimeout: getEnvVarNumber('BODY_TIMEOUT_SECS', 30) * 1000,
    handlerTimeout: getEnvVarNumber('HANDLER_TIMEOUT_SECS', 30) * 1000,
    bodySizeLimit: getEnvVarNumber('BODY_SIZE_LIMIT', 10 * 1024 * 1024),
    distDir,
    compiledApiDir: apiDir + path.sep,
    apiDir,
    apiEntry: path.join(apiDir, 'index.mjs'),
    base,
    isProd: process.env.NODE_ENV === 'production',
  };
}

let config: Config = readConfig();

function refreshConfig(): void {
  config = readConfig();
}

function resolveApiEntry(): string | null {
  return fs.existsSync(config.apiEntry) ? config.apiEntry : null;
}

// ─── ANSI colours ────────────────────────────────────────────────────────────

const C = {
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  DIM: '\x1b[2m',
} as const;

// ─── Path helpers ────────────────────────────────────────────────────────────

function stripBase(pathname: string): string | null {
  const { base } = config;
  if (!base) return pathname || '/';
  if (pathname === base || pathname === base + '/') return '/';
  if (pathname.startsWith(base + '/')) return pathname.slice(base.length) || '/';
  return null;
}

function toApiPath(pathname: string): string | null {
  let p = pathname;
  const { base } = config;
  if (base) {
    if (p === base || p.startsWith(base + '/')) p = p.slice(base.length) || '/';
    else return null;
  }
  if (p === '/api') return '/';
  if (p.startsWith('/api/')) return p.slice(4);
  return null;
}

function isApiRequest(url: string | undefined): boolean {
  if (!url) return false;
  try { return toApiPath(new URL(url, 'http://localhost').pathname) !== null; }
  catch { return false; }
}

// ─── Shell routes ────────────────────────────────────────────────────────────

function scanShellRoutes(): Set<string> {
  const routes = new Set<string>();

  function walk(dir: string, prefix: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'api') continue;

      const fullPath = path.join(dir, entry.name);
      const routePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.name.startsWith('[') && entry.name.endsWith(']')
          && fs.existsSync(path.join(fullPath, 'index.html'))) {
        routes.add(`/${routePath}`);
      }

      walk(fullPath, routePath);
    }
  }

  walk(config.distDir, '');
  return routes;
}

let shellRouteCache: Set<string> | null = null;

function getShellRoutes(): Set<string> {
  return (shellRouteCache ??= scanShellRoutes());
}

function findMatchingShellRoute(pathname: string): string | null {
  const pathSegments = pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);

  for (const shellRoute of getShellRoutes()) {
    const shellSegments = shellRoute.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
    if (shellSegments.length === 0) continue;

    const last = shellSegments[shellSegments.length - 1];
    const isRequiredCatchAll = last.startsWith('[...') && !last.startsWith('[[...');
    const isOptionalCatchAll = last.startsWith('[[') && last.endsWith(']]');

    if (isRequiredCatchAll || isOptionalCatchAll) {
      const prefix = shellSegments.slice(0, -1);
      if (pathSegments.length < prefix.length) continue;
      if (isRequiredCatchAll && pathSegments.length === prefix.length) continue;

      const matches = prefix.every((seg, i) =>
        (seg.startsWith('[') && seg.endsWith(']')) || seg === pathSegments[i]);
      if (matches) return shellRoute;
      continue;
    }

    if (shellSegments.length !== pathSegments.length) continue;

    const matches = shellSegments.every((seg, i) =>
      (seg.startsWith('[') && seg.endsWith(']')) || seg === pathSegments[i]);
    if (matches) return shellRoute;
  }

  return null;
}

// ─── Network ─────────────────────────────────────────────────────────────────

function getNetworkIp(): string | null {
  const ifaces = os.networkInterfaces();
  const SKIP = /docker|veth|br-|lo|loopback|vmnet|vbox|utun|tun|tap/i;

  const candidates: string[] = [];
  for (const name in ifaces) {
    if (SKIP.test(name)) continue;
    for (const iface of ifaces[name] ?? []) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      const [a, b] = iface.address.split('.').map(Number);
      if (a === 169 && b === 254) continue;
      const isPrivate = a === 10
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
      if (isPrivate) return iface.address;
      candidates.push(iface.address);
    }
  }

  return candidates[0] ?? null;
}

// ─── Banner ──────────────────────────────────────────────────────────────────

function printBanner(port: number): void {
  const envFiles = envFilesFor(process.cwd(), process.env.NODE_ENV ?? 'production');
  const networkIp = getNetworkIp();

  console.log(`\n  ${C.CYAN}ß Bini.js${C.RESET} (production)`);

  if (envFiles.length > 0) {
    const rel = envFiles.map((f) => path.relative(process.cwd(), f));
    console.log(`  ${C.GREEN}➜${C.RESET}  Environments: ${rel.join(', ')}`);
  }

  console.log(`  ${C.GREEN}➜${C.RESET}  Local:   ${C.CYAN}http://localhost:${port}/${C.RESET}`);

  if (networkIp) {
    console.log(`  ${C.GREEN}➜${C.RESET}  Network: ${C.CYAN}http://${networkIp}:${port}/${C.RESET}`);
  }

  if (config.base) {
    console.log(`  ${C.GREEN}➜${C.RESET}  Base:    ${C.CYAN}${config.base}${C.RESET}`);
  }

  console.log(`  ${C.DIM}${C.GREEN}➜${C.RESET}  ${C.DIM}press ${C.RESET}h + enter${C.DIM} to show help${C.RESET}`);
  console.log('');
}

// ─── Port helpers ────────────────────────────────────────────────────────────

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortFree(port)) return port;
    console.log(`Port ${port} is in use, trying another one...`);
  }
  throw new Error(`No free port found in range ${start}–${start + 99}`);
}

// ─── Keyboard loop ───────────────────────────────────────────────────────────

function startKeyboardLoop(port: number): void {
  if (!process.stdin.isTTY) return;

  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    switch (line.trim()) {
      case 'h':
        console.log('');
        console.log('  Shortcuts');
        console.log(`  ${C.DIM}press ${C.RESET}o + enter${C.RESET} to open in browser${C.RESET}`);
        console.log(`  ${C.DIM}press ${C.RESET}q + enter${C.RESET} to quit${C.RESET}`);
        console.log('');
        break;
      case 'o': {
        const url = `http://localhost:${port}${config.base || ''}/`;
        const cmd = process.platform === 'win32' ? `start ${url}`
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

// ─── Body / headers ──────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Request body timeout'));
    }, config.bodyTimeout);

    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > config.bodySizeLimit) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      clearTimeout(timer);
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined);
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
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

async function toWebRequest(req: http.IncomingMessage, host: string): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const body = method !== 'GET' && method !== 'HEAD' ? await readBody(req) : undefined;
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method,
    headers: normalizeHeaders(req.headers),
    body: body ? new Uint8Array(body) : null,
  });
}

// ─── API loader ──────────────────────────────────────────────────────────────

let apiFetch: ApiFetch | null = null;
let apiLoadPromise: Promise<ApiFetch> | null = null;

function noApiFetch(): ApiFetch {
  return async () => new Response(
    JSON.stringify({ error: 'No API routes compiled' }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );
}

function failedApiFetch(): ApiFetch {
  return async () => new Response(
    JSON.stringify({ error: 'API failed to load' }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  );
}

async function loadApiFetch(): Promise<ApiFetch> {
  if (apiFetch) return apiFetch;
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = (async () => {
    const entry = resolveApiEntry();

    if (!entry) {
      // Trigger the import lazily to get Node's native ERR_MODULE_NOT_FOUND
      try {
        await import(pathToFileURL(config.apiEntry).href);
      } catch (e) {
        const tag = process.stdout.isTTY ? `\x1b[33m[WARN]\x1b[0m` : `[WARN]`;
        console.warn(`\n${tag} failed to load handler for /api:`, e);
      }
      apiFetch = noApiFetch();
      return apiFetch;
    }

    try {
      const mod = await import(pathToFileURL(entry).href);
      if (typeof mod.fetch === 'function') {
        apiFetch = mod.fetch as ApiFetch;
      } else {
        apiFetch = failedApiFetch();
      }
    } catch {
      // bini-env / bini-router handles logging this error (e.g. missing chunks) — stay silent here to prevent duplication.
      apiFetch = failedApiFetch();
    }

    return apiFetch;
  })();

  return apiLoadPromise;
}

// ─── Response helpers ────────────────────────────────────────────────────────

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}

async function sendWebResponse(
  res: http.ServerResponse,
  webRes: Response,
  method: string,
): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  webRes.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'set-cookie') headers[k.toLowerCase()] = v;
  });

  const cookies = (webRes.headers as any).getSetCookie?.() as string[] | undefined;
  if (cookies && cookies.length > 0) headers['set-cookie'] = cookies;

  res.writeHead(webRes.status, headers);
  if (method === 'HEAD' || !webRes.body) { res.end(); return; }

  try {
    await pipeline(Readable.fromWeb(webRes.body as any), res);
  } catch {
    // client disconnected mid-stream
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Handler timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function publicErrorMessage(e: unknown): string {
  return config.isProd ? 'Internal server error' : (e instanceof Error ? e.message : String(e));
}

// ─── API handler ─────────────────────────────────────────────────────────────

async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const host = req.headers.host ?? 'localhost';

  let parsedUrl: URL;
  try { parsedUrl = new URL(`http://${host}${req.url ?? '/'}`); }
  catch { return sendJson(res, 400, { error: 'Bad request URL' }); }

  if (toApiPath(parsedUrl.pathname) === null) {
    return sendJson(res, 404, { error: 'Not Found' });
  }

  await loadApiFetch();

  let webReq: Request;
  try {
    webReq = await toWebRequest(req, host);
  } catch (e: any) {
    const message = e?.message ?? 'Bad request';
    return sendJson(res, message.includes('too large') ? 413 : 408, { error: message });
  }

  const ctx = { waitUntil(p: Promise<unknown>): void { p.catch(() => {}); } };

  try {
    const webRes = await withTimeout(
      apiFetch!(webReq, process.env as Record<string, unknown>, ctx),
      config.handlerTimeout,
    );
    await sendWebResponse(res, webRes, method);
  } catch (e) {
    const tag = process.stdout.isTTY ? `\x1b[33m[WARN]\x1b[0m` : `[WARN]`;
    console.error(`\n${tag} failed to handle ${method} ${parsedUrl.pathname}:`, e);
    if (!res.headersSent) sendJson(res, 500, { error: publicErrorMessage(e) });
    else res.end();
  }
}

// ─── Static serving ──────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
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
  status = 200,
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);

  let stat: fs.Stats;
  try { stat = await fs.promises.stat(filePath); }
  catch { res.writeHead(404); res.end('Not found'); return; }

  const etag = getETag(stat);
  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(status, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'ETag': etag,
    'X-Powered-By': 'Bini.js',
  });

  if (req.method === 'HEAD') { res.end(); return; }

  try { await pipeline(createReadStream(filePath), res); }
  catch { /* client disconnected mid-stream */ }
}

async function trySendFile(
  filePath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status = 200,
): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return false;
    await sendFile(filePath, req, res, status);
    return true;
  } catch {
    return false;
  }
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
): Promise<void> {
  const rawPathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (toApiPath(rawPathname) !== null) return next();

  const pathname = stripBase(rawPathname);
  if (pathname === null) return next();
  if (pathname.includes('\0') || pathname.split('/').some(s => s === '..')) return next();

  const hasExtension = path.extname(pathname).length > 0;
  if (hasExtension) {
    const filePath = path.join(config.distDir, pathname);
    if (filePath.startsWith(config.compiledApiDir)) return next();
    if (await trySendFile(filePath, req, res)) return;
    return next();
  }

  const staticIndex = path.join(config.distDir, pathname === '/' ? '' : pathname, 'index.html');
  if (await trySendFile(staticIndex, req, res)) return;

  const matchingShell = findMatchingShellRoute(pathname);
  if (matchingShell) {
    const shellIndex = path.join(config.distDir, matchingShell, 'index.html');
    if (await trySendFile(shellIndex, req, res)) return;
  }

  if (await trySendFile(path.join(config.distDir, '404.html'), req, res, 404)) return;

  if (await trySendFile(path.join(config.distDir, 'index.html'), req, res)) return;

  next();
}

// ─── Composer ────────────────────────────────────────────────────────────────

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
          res.end(JSON.stringify({ error: publicErrorMessage(e) }));
        }
      }
    };
    await next();
  };
}

// ─── Start ───────────────────────────────────────────────────────────────────

export async function start(): Promise<void> {
  loadEnvFiles(process.cwd(), process.env.NODE_ENV ?? 'production');
  refreshConfig();

  if (!fs.existsSync(config.distDir)) {
    console.error(`\n  ${C.RED}✗${C.RESET}  dist/ not found at ${config.distDir}.\n      Run ${C.CYAN}npm run build${C.RESET} first.\n`);
    process.exit(1);
  }

  getShellRoutes();

  const port = await findFreePort(config.defaultPort);

  const handler = compose([
    async (req, res, next) => {
      if (!isApiRequest(req.url)) return next();
      await handleApiRequest(req, res);
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
  server.headersTimeout = 66_000;
  server.maxHeadersCount = 2000;

  startKeyboardLoop(port);

  server.listen(port, '0.0.0.0', () => printBanner(port));

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}