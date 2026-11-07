# bini-server

[![npm version](https://img.shields.io/npm/v/bini-server?style=flat-square&logo=npm&logoColor=white&label=npm&color=CB3837&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=0a0a0a)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=0a0a0a)](https://nodejs.org)
[![bundle size](https://img.shields.io/bundlephobia/min/bini-server?style=flat-square&logo=npm&labelColor=0a0a0a)](https://bundlephobia.com/package/bini-server)
[![downloads](https://img.shields.io/npm/dt/bini-server?style=flat-square&logo=npm&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)

**Production server for [bini-router](https://www.npmjs.com/package/bini-router) apps.**
Serves the output of `vite build`: pre-rendered pages, static assets, and the compiled API bundle. It uses Node.js built-in modules and [bini-env](https://www.npmjs.com/package/bini-env) for `.env` loading.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [API Routes](#api-routes)
- [Static File Serving](#static-file-serving)
- [Deployment](#deployment)
- [Security](#security)
- [Verifying the Server](#verifying-the-server)
- [Configuration Examples](#configuration-examples)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Core

- **Static file serving.** Streams `dist/` with MIME types, ETag, and cache headers.
- **API routes.** Serves `/api/*` from the compiled bundle `dist/api/index.mjs`, which `vite build` produces from `src/app/api/`.
- **Route-aware fallbacks.** Pre-rendered pages first, then shell pages for dynamic routes, then `404.html`, then `index.html`.
- **ETag support.** `304 Not Modified` responses for unchanged static files.
- **Sub-path deployments.** Serve the app under a `BASE` path.

### Security and Reliability

- **Body limits.** Configurable request body size limit for API requests (default 10 MB).
- **Timeouts.** Configurable body read and handler timeouts (default 30 s each).
- **Path traversal protection.** Requests containing a `..` segment or a null byte are not served, and `dist/api/` is never served as a static file.
- **Error hiding in production.** With `NODE_ENV=production`, error responses say only `Internal server error`.
- **Port auto-increment.** Starts at `3000` and tries the next port while one is busy, up to 99 higher. Each busy port is logged.

### Operations

- **Auto env loading.** `.env` files are loaded at startup and listed in the banner.
- **Interactive shortcuts.** `h` for help, `o` to open the browser, `q` to quit.
- **Cross-platform browser opening.** `o` uses `start`, `open`, or `xdg-open` depending on the platform.
- **Graceful shutdown.** Handles `SIGTERM` and `SIGINT` with a timeout fallback.
- **Flexible config.** Supports `BINI_*`, `VITE_*`, or unprefixed environment variables.

---

## Requirements

- Node.js **≥ 20.19.0**
- A [bini-router](https://www.npmjs.com/package/bini-router) project with a finished `vite build`:
  - `dist/` (required; the server exits if it is missing)
  - `dist/api/index.mjs` (only for API routes; it must export `fetch()`)
  - pre-rendered pages, `404.html`, and shell pages from [bini-ssg](https://www.npmjs.com/package/bini-ssg) (optional)

---

## Install

```bash
npm install bini-server
# or
pnpm add bini-server
# or
yarn add bini-server
```

---

## Usage

### 1. Add to `package.json`

```json
{
  "scripts": {
    "build": "vite build",
    "start": "bini-server"
  }
}
```

### 2. Build and Start

```bash
npm run build   # Build your app
npm start       # Serve in production
```

### 3. Terminal Output

```text
  ß Bini.js (production)
  ➜  Environments: .env.local, .env
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.1.5:3000/
  ➜  press h + enter to show help
```

- `Environments` lists the `.env` files that were found, relative to the working directory, and is omitted when there are none.
- `Network` is the first private IPv4 address of a non-internal interface, skipping virtual interfaces such as Docker and VPN adapters. If there is none, it falls back to the first non-internal IPv4 address, and it is omitted when no address is found.
- `Base` appears as an extra line when `BASE` is set.

### Programmatic start

The module exports a single function:

```js
import { start } from 'bini-server'

await start()
```

### What `start()` does

1. Loads `.env` files from the working directory and re-reads the configuration.
2. Exits with code 1 when the `dist` directory does not exist.
3. Loads `dist/api/index.mjs` (a warning is printed if it is missing, see [API Routes](#api-routes)).
4. Scans `dist` once for shell pages.
5. Finds a free port, starting at `PORT` (see [Port selection](#port-selection)).
6. Starts the HTTP server on `0.0.0.0`, prints the banner, and starts the keyboard shortcuts.

---

## Keyboard Shortcuts

While the server is running, type a key and press `enter`:

| Key | Action |
| --- | --- |
| `h` | Show available shortcuts |
| `o` | Open `http://localhost:<port><base>/` in the default browser |
| `q` | Quit the server |

> Keyboard shortcuts are disabled when stdin is not a terminal (for example in CI/CD or most hosted platforms). When stdin closes, the process exits.

---

## Environment Variables

### `.env` Files

At startup, bini-server loads these files from the working directory, when they exist. They are listed from highest to lowest priority, with `[mode]` being `NODE_ENV` (or `production` when it is not set):

1. `.env.[mode].local`
2. `.env.[mode]`
3. `.env.local`
4. `.env`

A variable that is already set in the environment is never overridden by a file, and a higher-priority file wins over a lower one. The loaded values are available through `process.env`, which is also what API routes receive as `env`. The server settings below can come from these files too.

### Server Configuration

All settings support **three naming conventions:**

| Convention | Example | Priority |
| --- | --- | --- |
| `BINI_*` | `BINI_PORT=3000` | Highest |
| `VITE_*` | `VITE_PORT=3000` | Medium |
| No prefix | `PORT=3000` | Lowest |

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port to listen on. If it is in use, the next free port is used (see [Port selection](#port-selection)) |
| `DIST_DIR` | `dist` | Build output folder, relative to the working directory |
| `BASE` | *(empty)* | Sub-path the app is served under. `''`, `/`, `.`, and `./` mean no base; any other value is normalized to a leading slash with no trailing slash (`app/` becomes `/app`) |
| `BODY_TIMEOUT_SECS` | `30` | Max seconds to read an API request body |
| `HANDLER_TIMEOUT_SECS` | `30` | Max seconds for the API handler to respond |
| `BODY_SIZE_LIMIT` | `10485760` | Max API request body size in bytes (10 MB) |

Values that are not numbers fall back to the default. Setting a limit or timeout to `0` does **not** disable it: a body limit of `0` rejects any request body, and a timeout of `0` expires immediately.

The server also reads `NODE_ENV`. When it is `production`, error responses hide the underlying message.

### Port selection

The server checks `PORT`, then each following port, until it finds one that is free on `0.0.0.0`. It logs one line for every busy port it skips:

```text
Port 3000 is in use, trying another one...
```

The banner then shows the port that was actually used in the `Local` and `Network` URLs. The search covers 100 ports (`PORT` through `PORT + 99`); if none is free, `start()` fails with `No free port found in range <start>–<end>`.

### Examples

```bash
# .env file
PORT=8080
BODY_SIZE_LIMIT=5242880  # 5MB

# Or inline
PORT=3001 bini-server

# Or with the BINI prefix (takes precedence over PORT)
BINI_PORT=3002 bini-server
```

---

## Project Structure

```text
my-app/
├── dist/                    # Built output (required)
│   ├── index.html
│   ├── about/index.html     # Pre-rendered pages (bini-ssg)
│   ├── blog/[slug]/index.html  # Shell page for a dynamic route (bini-ssg)
│   ├── 404.html
│   ├── assets/
│   └── api/
│       └── index.mjs        # Compiled API bundle (not served as a file)
├── src/
│   ├── app/
│   │   ├── api/             # API handlers, compiled into dist/api at build time
│   │   │   ├── users.ts
│   │   │   └── posts/
│   │   │       ├── index.ts
│   │   │       └── [id].ts
│   │   └── layout.tsx
│   └── main.tsx
├── .env                     # Environment variables
├── package.json
└── vite.config.ts
```

---

## API Routes

Requests to `<base>/api` and `<base>/api/...` are passed to the `fetch` export of `dist/api/index.mjs`, which `vite build` produces when `src/app/api` exists. bini-server does not read `src/` at runtime. The bundle is loaded once, at startup.

### What the bundle receives

```ts
fetch(request: Request, env: NodeJS.ProcessEnv, ctx: { waitUntil(p: Promise<unknown>): void })
```

- **`request`:** a standard `Request` whose URL is `http://<host header><original request URL>`. Header arrays are joined with a comma and a space (the `cookie` header with a semicolon and a space), and the body is read for every method except `GET` and `HEAD`.
- **`env`:** `process.env`, so [bini-env](https://www.npmjs.com/package/bini-env)'s `getEnv(c, key)` sees the same values, including those loaded from `.env` files.
- **`ctx.waitUntil`:** accepts a promise and swallows its rejection; the server does not wait for it.

The response status and headers (including every `Set-Cookie`) are copied, and the body is streamed to the client. `HEAD` requests receive headers only.

### Supported handler formats

How handlers are written, routed, and matched is defined by bini-router. For example:

```typescript
// src/app/api/hello.ts

// 1. Hono app (default export with .fetch)
import { Hono } from 'hono'
const app = new Hono()
app.get('/hello', (c) => c.json({ message: 'Hello' }))
export default app

// 2. Plain function (default export)
export default (req: Request) => Response.json({ message: 'Hello' })

// 3. Per-method exports
export function GET(req: Request, { params }) {
  return Response.json({ id: params.id })
}
```

Only `.ts` and `.js` files in `src/app/api/` are used.

### Dynamic routes

```text
src/app/api/
  users/
    [id].ts       → /api/users/:id
  posts/
    [...slug].ts  → /api/posts/*
```

Route parameters arrive in the second argument of a handler (`{ params, searchParams, env, waitUntil }`). See the [bini-router](https://www.npmjs.com/package/bini-router) documentation for the full routing rules.

### CORS

bini-server does not add CORS headers or answer preflight requests itself. CORS is handled by the compiled bundle and is controlled by the `cors` option of `biniroute()` in `vite.config.ts` (it is off by default).

### Base path

bini-server and the compiled API each check the base path, so set `BASE` to the sub-path your app was built for.

### Request limits

The server's `BODY_SIZE_LIMIT` applies, and so does the bundle's own `bodySizeLimit` (the `biniroute()` option, 1 MB by default), so the lower of the two limits is the one you hit.

### When the bundle is missing

If `dist/api/index.mjs` is missing or does not export `fetch()`, the server prints a warning at startup, and every API request returns `404` with `{"error":"No API routes compiled"}`.

---

## Static File Serving

### Lookup order

For a path **with** a file extension, the server looks for that file under `dist/`. Anything under `dist/api/` is never served. If the file does not exist, the response is a plain-text `404 Not found`.

For a path **without** an extension, the server uses the first of these that applies:

| Order | Looks for | Status |
| --- | --- | --- |
| 1 | `dist/<path>/index.html` (pre-rendered page) | 200 |
| 2 | A shell page whose folder name matches the path | 200 |
| 3 | `dist/404.html` | 404 |
| 4 | `dist/index.html` (client-side fallback) | 200 |
| 5 | Nothing found | plain-text 404 |

When `BASE` is set, only paths under it are served.

### Shell pages

At startup the server scans `dist` once for folders whose names are wrapped in square brackets and that contain an `index.html`, such as `dist/blog/[slug]/index.html`. A new build requires a restart to be picked up. Folders named `api`, dot-folders, and `node_modules` are skipped.

| Folder | Matches |
| --- | --- |
| `blog/[slug]` | `/blog/anything` (exactly one segment in that position) |
| `docs/[...path]` | `/docs/a`, `/docs/a/b` (at least one segment) |
| `docs/[[...path]]` | `/docs`, `/docs/a`, `/docs/a/b` (zero or more segments) |

Bracketed segments match any value, other segments must match exactly, and the first matching shell wins; there is no ranking by specificity.

### Supported MIME Types

| Type | Extensions |
| --- | --- |
| Documents and code | `.html`, `.js`, `.mjs`, `.css`, `.json`, `.map`, `.txt`, `.xml`, `.webmanifest` |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif`, `.ico` |
| Fonts | `.woff`, `.woff2`, `.ttf`, `.eot` |

Any other extension is served as `application/octet-stream`. Every file response also carries `Content-Length` and `X-Powered-By: Bini.js`.

### Cache Headers

| File Type | Cache Policy |
| --- | --- |
| **Files inside an `assets/` folder** | `public, max-age=31536000, immutable` (1 year) |
| **All other files** | `no-cache` |

### ETag Support

ETags are generated from the file `size` and `mtimeMs`:

- An `ETag` header is sent on every file response (an MD5 hash of those two values, 16 characters).
- A request whose `If-None-Match` equals the ETag exactly receives `304 Not Modified` (for `200` responses).

bini-server does not compress responses.

---

## Deployment

### What to ship

bini-server needs the build output, not your source: deploy `dist/` (including `dist/api/index.mjs`), `package.json`, and the installed dependencies. The compiled API leaves packages from `node_modules` external, so dependencies must be installed on the server.

- **VPS / pm2:** deploy the project directory, install dependencies, and build
- **Railway, Render, Fly.io:** build as part of the deploy
- **Docker:** build inside the image, as shown below

### VPS / Dedicated Server

```bash
npm run build
npm start

# With pm2 (recommended)
npm install -g pm2
pm2 start "npm start" --name my-app
pm2 save
pm2 startup
```

### Platform as a Service

| Platform | Start Command | Notes |
| --- | --- | --- |
| **Railway** | `npm start` | PORT injected automatically |
| **Render** | `npm start` | PORT injected automatically |
| **Fly.io** | `npm start` | See the fly.toml example below |
| **Heroku** | `npm start` | PORT injected automatically |

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

### Fly.io

```toml
# fly.toml
[processes]
  app = "npm start"
```

---

## Security

| Feature | Default | Configured with |
| --- | --- | --- |
| Body size limit (API) | 10 MB | `BODY_SIZE_LIMIT` |
| Body read timeout (API) | 30 s | `BODY_TIMEOUT_SECS` |
| Handler timeout (API) | 30 s | `HANDLER_TIMEOUT_SECS` |
| Path traversal | `..` segments and null bytes are not served | Not configurable |
| Compiled API files | `dist/api/` is never served as static files | Not configurable |
| Error messages | Hidden when `NODE_ENV=production` | `NODE_ENV` |
| CORS | Handled by the compiled API | `biniroute({ cors })` |

---

## Verifying the Server

```bash
# Check static files
curl http://localhost:3000/

# Check API routes
curl http://localhost:3000/api/hello

# Check ETag
curl -I http://localhost:3000/assets/app.js

# Test 304 Not Modified
curl -I http://localhost:3000/assets/app.js \
  -H "If-None-Match: [etag_from_previous_request]"
```

---

## Configuration Examples

### Production

```bash
NODE_ENV=production
PORT=3000
BODY_TIMEOUT_SECS=30
HANDLER_TIMEOUT_SECS=30
BODY_SIZE_LIMIT=10485760
```

### Served under a sub-path

```bash
BASE=/app
```

### Smaller request bodies

```bash
BODY_SIZE_LIMIT=1048576  # 1MB
```

### Larger uploads

```bash
BODY_SIZE_LIMIT=104857600  # 100MB
BODY_TIMEOUT_SECS=300      # 5 minutes
```

Raise `bodySizeLimit` in `biniroute()` too, otherwise the bundle's own limit still applies.

---

## API Reference

### Environment Variables Priority

1. `BINI_*` (highest)
2. `VITE_*` (medium)
3. No prefix (lowest)

### Returned HTTP Status Codes

These are produced by bini-server itself. API handlers may return any status.

| Code | Description |
| --- | --- |
| `200` | Success |
| `304` | Not Modified (ETag match) |
| `400` | Bad request URL (API requests) |
| `404` | Not found (missing file, unknown path, or no compiled API), or `404.html` for unknown page paths |
| `408` | API request body not received in time, or a read error |
| `413` | API request body too large |
| `500` | Internal server error (including API handler timeout) |

In production (`NODE_ENV=production`) the message in `500` responses is always `Internal server error`.

### Supported HTTP Methods

All methods are passed to the API bundle, which decides which it accepts. Static responses do not check the method, and `HEAD` receives headers only.

---

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## License

MIT © [Binidu Ranasinghe](https://bini.js.org)

---

## Links

- [GitHub](https://github.com/Binidu01/bini-server)
- [npm](https://www.npmjs.com/package/bini-server)
- [Bini.js](https://bini.js.org)
- [Issues](https://github.com/Binidu01/bini-server/issues)

---

Maintained by [Binidu Ranasinghe](https://github.com/Binidu01)
