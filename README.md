# bini-server

[![npm version](https://img.shields.io/npm/v/bini-server?style=flat-square&logo=npm&logoColor=white&label=npm&color=CB3837&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=0a0a0a)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/min/bini-server?style=flat-square&logo=npm&labelColor=0a0a0a)](https://bundlephobia.com/package/bini-server)
[![downloads](https://img.shields.io/npm/dt/bini-server?style=flat-square&logo=npm&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)

**Production server for Bini.js apps.**
Serves the output of your build from `dist/`: static files, pre-rendered pages, and the compiled API bundle at `dist/api/index.mjs`. It imports only Node.js built-in modules and [bini-env](https://www.npmjs.com/package/bini-env) (for `.env` loading).

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Usage](#usage)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Environment Variables](#environment-variables)
- [Expected Build Output](#expected-build-output)
- [API Routes](#api-routes)
- [Static File Serving](#static-file-serving)
- [Deployment Notes](#deployment-notes)
- [Security](#security)
- [Verifying the Server](#verifying-the-server)
- [Configuration Examples](#configuration-examples)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Core

- **Static file serving.** Streams files from `dist/` with MIME types, an `ETag`, and `Cache-Control` headers.
- **API routes.** Forwards `<base>/api` and `<base>/api/...` requests to the `fetch` export of `dist/api/index.mjs`.
- **Route-aware fallbacks.** Pre-rendered pages first, then shell pages for bracketed dynamic-route folders, then `404.html`, then `index.html`.
- **ETag support.** Responds `304 Not Modified` when `If-None-Match` equals the file's ETag.
- **Sub-path deployments.** Serve the app under a `BASE` path.

### Security and Reliability

- **Body limits.** Configurable request body size limit for API requests (default 10 MB).
- **Timeouts.** Configurable body read and handler timeouts (default 30 s each).
- **Path traversal protection.** Paths containing a `..` segment or a null byte are not served, and `dist/api/` is never served as static files.
- **Error hiding in production.** With `NODE_ENV=production`, `500` responses contain only `Internal server error`.
- **Port auto-increment.** Starts at `PORT` (default `3000`) and tries the next port while one is busy, up to 99 higher. Each busy port is logged.

### Operations

- **Env file loading.** Environment files are loaded through bini-env at startup, and the banner lists the files bini-env reports.
- **Interactive shortcuts.** `h` for help, `o` to open the browser, `q` to quit (only when stdin is a terminal).
- **Graceful shutdown.** Handles `SIGTERM` and `SIGINT`, with a 10 second fallback that exits with code 1.
- **Flexible config.** Supports `BINI_*`, `VITE_*`, or unprefixed environment variables.

---

## Requirements

- Node.js (the server uses the global `Request` and `Response` classes, `Headers#getSetCookie`, and `Readable.fromWeb`)
- A finished build in `dist/` (relative to the working directory):
  - `dist/` (required; the server exits with code 1 if it is missing)
  - `dist/api/index.mjs` (the compiled API bundle; it must export a function named `fetch`)
  - Pre-rendered pages, `404.html`, and shell pages (optional)

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
  ➜  Environments: .env
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.1.5:3000/
  ➜  press h + enter to show help
```

- `(production)` is always printed.
- `Environments` lists the env files reported by bini-env, relative to the working directory. It is omitted when there are none.
- `Local` and `Network` show the port that was actually bound. They do not include `BASE`.
- `Network` is the first private IPv4 address (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`) of a non-internal interface. If there is none, it falls back to the first other non-internal IPv4 address (link-local `169.254.x.x` addresses are skipped). Interfaces whose names contain any of `docker`, `veth`, `br-`, `lo`, `loopback`, `vmnet`, `vbox`, `utun`, `tun`, or `tap` (case-insensitive) are ignored. The line is omitted when no address is found.
- `Base` appears as an extra line when `BASE` is set.

### Programmatic start

The module exports a single function:

```js
import { start } from 'bini-server'

await start()
```

### What `start()` does

1. Loads env files with bini-env (mode is `NODE_ENV`, or `production` when it is not set), then re-reads the configuration.
2. Prints an error and exits with code 1 when the `dist` directory does not exist.
3. Scans `dist` once for shell pages.
4. Finds a free port, starting at `PORT` (see [Port selection](#port-selection)).
5. Creates the HTTP server, starts the keyboard shortcuts (if stdin is a terminal), listens on `0.0.0.0`, and prints the banner once listening.
6. Registers `SIGTERM` and `SIGINT` handlers.

`dist/api/index.mjs` is **not** loaded at startup. It is loaded on the first API request (see [API Routes](#api-routes)).

---

## Keyboard Shortcuts

While the server is running, type a key and press `enter`:

| Key | Action |
| --- | --- |
| `h` | Show available shortcuts |
| `o` | Open `http://localhost:<port><base>/` in the default browser |
| `q` | Quit the server |

> Keyboard shortcuts are only enabled when stdin is a terminal. While they are active, closing stdin exits the process.

---

## Environment Variables

### `.env` Files

At startup, bini-server calls bini-env's `loadEnvFiles` for the working directory, using `NODE_ENV` as the mode (or `production` when it is not set), and then re-reads its own configuration. Which files are loaded and in what priority is defined by bini-env; see its documentation.

### Server Configuration

All settings support **three naming conventions:**

| Convention | Example | Priority |
| --- | --- | --- |
| `BINI_*` | `BINI_PORT=3000` | Highest |
| `VITE_*` | `VITE_PORT=3000` | Medium |
| No prefix | `PORT=3000` | Lowest |

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to start from. If it is in use, the next free port is used (see [Port selection](#port-selection)) |
| `DIST_DIR` | `dist` | Build output folder, relative to the working directory |
| `BASE` | *(empty)* | Sub-path the app is served under. `''`, `/`, `.`, and `./` mean no base; any other value is normalized to a leading slash with no trailing slash (`app/` becomes `/app`) |
| `BODY_TIMEOUT_SECS` | `30` | Max seconds to read an API request body |
| `HANDLER_TIMEOUT_SECS` | `30` | Max seconds for the API handler to respond |
| `BODY_SIZE_LIMIT` | `10485760` | Max API request body size in bytes (10 MB) |

Numeric values are parsed with `parseInt`; a value that cannot be parsed as an integer falls back to the default. Setting a limit or timeout to `0` does **not** disable it: a body limit of `0` rejects any non-empty request body.

The server also reads `NODE_ENV`. Only when it is exactly `production` do `500` responses hide the underlying error message; otherwise the message is included.

### Port selection

The server checks `PORT`, then each following port, until it finds one that is free on `0.0.0.0`. It logs one line for every busy port it skips:

```text
Port 3000 is in use, trying another one...
```

The banner shows the port that was actually used. The search covers 100 ports (`PORT` through `PORT + 99`); if none is free, `start()` rejects with `No free port found in range <start>–<end>`.

### Examples

```bash
# Inline
PORT=3001 bini-server

# With the BINI prefix (takes precedence over PORT)
BINI_PORT=3002 bini-server
```

---

## Expected Build Output

bini-server serves whatever is in `dist/` (or `DIST_DIR`). It does not read your source files at runtime.

```text
dist/
├── index.html
├── about/index.html          # Pre-rendered page
├── blog/[slug]/index.html    # Shell page for a dynamic route
├── 404.html
├── assets/
└── api/
    └── index.mjs             # API bundle (never served as a file)
```

---

## API Routes

Requests to `<base>/api` and `<base>/api/...` are passed to the `fetch` export of `dist/api/index.mjs`. The bundle is imported once, lazily, when the first API request arrives, and the result is reused for all later requests.

### What the bundle receives

```ts
fetch(request: Request, env: NodeJS.ProcessEnv, ctx: { waitUntil(p: Promise<unknown>): void })
```

- **`request`:** a standard `Request` whose URL is `http://<host header><original request URL>` (the host defaults to `localhost` when there is no `Host` header). The URL keeps the original path, including `BASE` and `/api`. Header arrays are joined with `,` (the `cookie` header with `;`). The body is read for every method except `GET` and `HEAD`.
- **`env`:** `process.env`.
- **`ctx.waitUntil`:** accepts a promise and swallows its rejection; the server does not wait for it.

The response status and headers (including every `Set-Cookie`) are copied, and the body is streamed to the client. `HEAD` requests receive headers only.

### CORS

bini-server does not add CORS headers or answer preflight requests. Any CORS handling has to come from the API bundle.

### Base path

When `BASE` is set, only requests under it are treated as API requests (`<base>/api/...`). The `Request` passed to the bundle keeps the full original URL, including the base.

### Request limits

`BODY_SIZE_LIMIT` and `BODY_TIMEOUT_SECS` apply while the body is read, and `HANDLER_TIMEOUT_SECS` applies while waiting for the handler. The handler is not cancelled when the timeout fires.

### When the bundle is missing or broken

- **`dist/api/index.mjs` does not exist:** on the first API request the server prints a `[WARN] failed to load handler for /api:` message, and every API request returns `503` with `{"error":"No API routes compiled"}`.
- **The file exists but fails to import, or does not export a `fetch` function:** every API request returns `500` with `{"error":"API failed to load"}`.

---

## Static File Serving

### Lookup order

For a path **with** a file extension (as determined by `path.extname`), the server looks for that file under `dist/`. Anything under `dist/api/` is never served. If the file does not exist, the response is a plain-text `404 Not found`.

For a path **without** an extension, the server uses the first of these that applies:

| Order | Looks for | Status |
| --- | --- | --- |
| 1 | `dist/<path>/index.html` (pre-rendered page) | 200 |
| 2 | The `index.html` of a matching shell page | 200 |
| 3 | `dist/404.html` | 404 |
| 4 | `dist/index.html` | 200 |
| 5 | Nothing found (plain-text `Not found`) | 404 |

When `BASE` is set, only paths under it are served; other paths get the plain-text `404 Not found`.

### Shell pages

At startup the server scans `dist` once for folders whose names are wrapped in square brackets and that contain an `index.html`, such as `dist/blog/[slug]/index.html`. The result is cached, so a new build requires a restart to be picked up. Folders named `api` (at any depth), folders starting with `.`, and `node_modules` are skipped.

| Folder | Matches |
| --- | --- |
| `blog/[slug]` | `/blog/anything` (exactly one segment in that position) |
| `docs/[...path]` | `/docs/a`, `/docs/a/b` (at least one segment) |
| `docs/[[...path]]` | `/docs`, `/docs/a`, `/docs/a/b` (zero or more segments) |

Bracketed segments match any value and other segments must match exactly. Shell pages are checked in the order the scan found them, and the first match wins; there is no ranking by specificity.

### Supported MIME Types

| Extensions | Content-Type |
| --- | --- |
| `.html` | `text/html; charset=utf-8` |
| `.js`, `.mjs` | `application/javascript` |
| `.css` | `text/css` |
| `.json`, `.map` | `application/json` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.ico` | `image/x-icon` |
| `.webp` | `image/webp` |
| `.avif` | `image/avif` |
| `.woff` | `font/woff` |
| `.woff2` | `font/woff2` |
| `.ttf` | `font/ttf` |
| `.eot` | `application/vnd.ms-fontobject` |
| `.txt` | `text/plain` |
| `.xml` | `application/xml` |
| `.webmanifest` | `application/manifest+json` |

Any other extension is served as `application/octet-stream`. Every file response also carries `Content-Length`, `ETag`, `Cache-Control`, and `X-Powered-By: Bini.js`.

### Cache Headers

| File Type | Cache Policy |
| --- | --- |
| **Files whose absolute path contains an `assets` folder** | `public, max-age=31536000, immutable` (1 year) |
| **All other files** | `no-cache` |

The `assets` check is made on the full absolute file path, not only the part inside `dist/`.

### ETag Support

ETags are generated from the file `size` and `mtimeMs`:

- An `ETag` header is sent on every file response (the first 16 characters of an MD5 hex digest of those two values).
- A request whose `If-None-Match` header equals the ETag exactly receives `304 Not Modified`. This check is skipped for the `404.html` response.

bini-server does not compress responses.

---

## Deployment Notes

- The server resolves `dist` (or `DIST_DIR`) against the process's current working directory, so start it from your project root.
- It listens on `0.0.0.0`.
- Set `PORT` (or `BINI_PORT` / `VITE_PORT`) to choose the starting port.
- On `SIGTERM` or `SIGINT` it stops accepting connections and exits with code 0 once the server has closed, or with code 1 after 10 seconds.
- Keyboard shortcuts are disabled when stdin is not a terminal.
- Fixed (not configurable) server settings: keep-alive timeout 65 s, headers timeout 66 s, max 2000 headers, and `Connection: keep-alive` on every response.

---

## Security

| Feature | Default | Configured with |
| --- | --- | --- |
| Body size limit (API) | 10 MB | `BODY_SIZE_LIMIT` |
| Body read timeout (API) | 30 s | `BODY_TIMEOUT_SECS` |
| Handler timeout (API) | 30 s | `HANDLER_TIMEOUT_SECS` |
| Path traversal | `..` segments and null bytes are not served | Not configurable |
| Compiled API files | `dist/api/` is never served as static files | Not configurable |
| Error messages | `500` responses hide the message when `NODE_ENV=production` | `NODE_ENV` |
| CORS | Not handled by bini-server | n/a |

---

## Verifying the Server

```bash
# Check static files
curl http://localhost:3000/

# Check an API route (if your API bundle handles it)
curl http://localhost:3000/api/hello

# Check ETag (use a file that exists in dist/)
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

---

## API Reference

### Environment Variables Priority

1. `BINI_*` (highest)
2. `VITE_*` (medium)
3. No prefix (lowest)

### HTTP Status Codes Produced by bini-server

API handlers may return any status.

| Code | Description |
| --- | --- |
| `200` | Success |
| `304` | Not Modified (ETag match) |
| `400` | Bad request URL (API requests) |
| `404` | Missing file or unknown path (plain-text `Not found`), or `404.html` for an unknown extensionless path when it exists |
| `408` | API request body not received within `BODY_TIMEOUT_SECS`, or another error while reading it |
| `413` | API request body larger than `BODY_SIZE_LIMIT` |
| `500` | API handler error or handler timeout, API bundle failed to load, or an error in a request middleware |
| `503` | `dist/api/index.mjs` is missing (`No API routes compiled`) |

The `408` and `413` cases destroy the incoming request before the response is written, so a client may see a closed connection instead of the JSON error.

With `NODE_ENV=production` the message in `500` responses from handler errors is always `Internal server error`.

### Supported HTTP Methods

All methods are passed to the API bundle, which decides which it accepts. Static file responses do not check the method, and `HEAD` receives headers only.

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
