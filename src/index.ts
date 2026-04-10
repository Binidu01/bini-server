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
import { pathToFileURL } from 'url';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { loadEnv, detectEnvFiles } from 'bini-env';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORT = parseInt(process.env.PORT ?? '3000', 10);
const API_DIR = path.join(process.cwd(), process.env.BINI_API_DIR ?? 'src/app/api');
const DIST_DIR = path.join(process.cwd(), process.env.BINI_DIST_DIR ?? 'dist');
const API_EXTS = ['.ts', '.js'] as const;
const BODY_TIMEOUT = 30_000;
const HANDLER_TIMEOUT = 30_000;
const BODY_SIZE_LIMIT = 10 * 1024 * 1024;

const C = {
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  DIM: '\x1b[2m',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiRoute {
  routePath: string;
  filePath: string;
}

type Middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void | Promise<void>;

// ─── Network ──────────────────────────────────────────────────────────────────

function getAllNetworkIps(): string[] {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name in ifaces) {
    if (/docker|veth|br-|lo|loopback|vmnet|vbox|utun|tun|tap/i.test(name)) continue;
    for (const iface of ifaces[name] ?? []) {
      if (iface.internal || iface.family !== 'IPv4') continue;
      ips.push(iface.address);
    }
  }
  return [...new Set(ips)];
}

function printBanner(port: number) {
  const networkIps = getAllNetworkIps();
  const envFiles = detectEnvFiles(process.cwd()).map(f => f.name);

  console.log(`\n  ${C.CYAN}ß Bini.js${C.RESET} (production)\n`);
  if (envFiles.length > 0) {
    console.log(`  ${C.GREEN}➜${C.RESET}  Environments: ${envFiles.join(', ')}`);
  }
  console.log(`  ${C.GREEN}➜${C.RESET}  Local:   ${C.CYAN}http://localhost:${port}/${C.RESET}`);
  for (const ip of networkIps) {
    console.log(`  ${C.GREEN}➜${C.RESET}  Network: ${C.CYAN}http://${ip}:${port}/${C.RESET}`);
  }
  if (!fs.existsSync(API_DIR)) {
    console.log(`\n  ${C.DIM}No api directory found — API routes disabled.${C.RESET}`);
  }
  console.log('');
}

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
        console.log(`\n  ${C.YELLOW}⚠${C.RESET}  Port ${start} is in use, using port ${C.CYAN}${port}${C.RESET} instead.`);
      }
      return port;
    }
  }
  throw new Error(`No free port found between ${start} and ${start + 100}`);
}

// ─── API Route Scanner ────────────────────────────────────────────────────────

function scanApiRoutes(dir: string, baseRoute = ''): ApiRoute[] {
  const routes: ApiRoute[] = [];
  if (!fs.existsSync(dir)) return routes;

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
      const isDynamic = entry.name.startsWith('[') && entry.name.endsWith(']');
      const segment = isCatchAll ? '*' : isDynamic ? `:${entry.name.slice(1, -1)}` : entry.name;
      routes.push(...scanApiRoutes(fullPath, `${baseRoute}/${segment}`));
      continue;
    }

    const ext = path.extname(entry.name);
    const base = path.basename(entry.name, ext);
    if (!(API_EXTS as readonly string[]).includes(ext)) continue;

    const isCatchAll = base.startsWith('[...') && base.endsWith(']');
    const isDynamic = base.startsWith('[') && base.endsWith(']');

    let routePath: string;
    if (isCatchAll) {
      routePath = `${baseRoute}/*`;
    } else if (base === 'index') {
      routePath = baseRoute || '/';
    } else if (isDynamic) {
      routePath = `${baseRoute}/:${base.slice(1, -1)}`;
    } else {
      routePath = `${baseRoute}/${base}`;
    }

    const normalizedPath = `/api${routePath}`;
    routes.push({ routePath: normalizedPath, filePath: fullPath });
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
      if (prefix[i].startsWith(':')) continue;
      if (prefix[i] !== urlParts[i]) return null;
    }
    return { '*': urlParts.slice(prefix.length).join('/') };
  }

  if (patParts.length !== urlParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
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
  if (cached && cached.mtime === mtime) return cached.handler;

  try {
    const mod = await import(pathToFileURL(filePath).href + '?t=' + mtime);
    const handler = mod.default ?? null;
    moduleCache.set(filePath, { mtime, handler });
    return handler;
  } catch {
    moduleCache.delete(filePath);
    return null;
  }
}

// ─── Body reader ──────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('Request body timeout'));
    }, BODY_TIMEOUT);

    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > BODY_SIZE_LIMIT) {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      clearTimeout(timeout);
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined);
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function normalizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? (k.toLowerCase() === 'cookie' ? v.join('; ') : v.join(', ')) : v;
  }
  return out;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function isHonoApp(handler: any): boolean {
  return handler && typeof handler.fetch === 'function';
}

// ─── API middleware ───────────────────────────────────────────────────────────

let routeCache: ApiRoute[] | null = null;

async function handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' });
      res.end();
      return;
    }

    if (!routeCache) {
      routeCache = scanApiRoutes(API_DIR);
    }

    const host = req.headers.host ?? 'localhost';
    const url = `http://${host}${req.url ?? ''}`;
    const pathname = new URL(url).pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    let matchedRoute: ApiRoute | undefined;
    for (const route of routeCache) {
      if (matchRoute(route.routePath, pathname) !== null) {
        matchedRoute = route;
        break;
      }
    }

    if (!matchedRoute) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: `No API handler found for ${req.url}` }));
      return;
    }

    let body: Buffer | undefined;
    try {
      body = !['GET', 'HEAD'].includes(method) ? await readBody(req) : undefined;
    } catch (e: any) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const handler = await importHandler(matchedRoute.filePath);
    if (!handler) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: `Failed to load handler for ${matchedRoute.routePath}` }));
      return;
    }

    let webRes: Response;

    try {
      if (isHonoApp(handler)) {
        const newUrl = url.replace(/^https?:\/\/[^\/]+\/api/, `http://${host}`);
        const modifiedReq = new Request(newUrl, {
          method,
          headers: normalizeHeaders(req.headers),
          body: (body as BodyInit | null) ?? null,
        });
        webRes = await (handler as any).fetch(modifiedReq);
      } else if (typeof handler === 'function') {
        const params = matchRoute(matchedRoute.routePath, pathname);
        const reqWithParams = new Request(url, {
          method,
          headers: {
            ...normalizeHeaders(req.headers),
            'x-bini-params': JSON.stringify(params ?? {}),
          },
          body: (body as BodyInit | null) ?? null,
        });

        const result = await Promise.race([
          (handler as Function)(reqWithParams),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Handler timeout')), HANDLER_TIMEOUT)),
        ]);

        webRes = result instanceof Response ? result : new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        throw new Error('Invalid handler type');
      }
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: e.message ?? 'Internal Server Error' }));
      return;
    }

    const finalHeaders: Record<string, string> = { ...CORS_HEADERS };
    webRes.headers.forEach((v, k) => {
      finalHeaders[k] = v;
    });

    res.writeHead(webRes.status, finalHeaders);
    res.end(Buffer.from(await webRes.arrayBuffer()));
  } catch (e: any) {
    next();
  }
}

// ─── Static file server ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
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
  return crypto.createHash('md5').update(`${stat.size}-${stat.mtimeMs}`).digest('hex').slice(0, 16);
}

async function sendFile(filePath: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME[ext] ?? 'application/octet-stream';
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const etag = getETag(stat);
  const ifNoneMatch = req.headers['if-none-match'];

  if (ifNoneMatch === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': stat.size,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'ETag': etag,
    'X-Powered-By': 'Bini.js',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  try {
    await pipeline(createReadStream(filePath), res);
  } catch {
    // Client disconnected mid-stream — ignore
  }
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (pathname.startsWith('/api')) {
    return next();
  }

  const filePath = path.join(DIST_DIR, pathname);

  try {
    await fs.promises.access(filePath);
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile()) {
      await sendFile(filePath, req, res);
      return;
    }
  } catch {
    // File doesn't exist, continue to fallback
  }

  const indexPath = path.join(DIST_DIR, 'index.html');
  try {
    await fs.promises.access(indexPath);
    await sendFile(indexPath, req, res);
    return;
  } catch {
    next();
  }
}

// ─── Middleware composer ──────────────────────────────────────────────────────

function compose(middlewares: Middleware[]) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
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

export async function start() {
  await loadEnv(process.cwd());

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`\n  ${C.RED}✗${C.RESET}  dist/ not found. Run ${C.CYAN}npm run build${C.RESET} first.\n`);
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
  server.headersTimeout = 66_000;

  server.listen(port, '0.0.0.0', () => {
    printBanner(port);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}