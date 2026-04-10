# bini-server

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-server?color=00CFFF&labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-server)
[![license](https://img.shields.io/badge/license-MIT-00CFFF?labelColor=0a0a0a&style=flat-square)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-00CFFF?labelColor=0a0a0a&style=flat-square)](https://nodejs.org)
[![bini-env](https://img.shields.io/badge/bini--env-powered-00CFFF?labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-env)

**Zero-dependency production server for [bini-router](https://www.npmjs.com/package/bini-router) apps.**  
Serves your `dist/` statically and handles `/api/*` from your `src/app/api/` handlers — just like `vite preview`, but production-grade.

</div>

---

## Features

- ⚡ **Zero dependencies** — pure Node.js built-ins only
- 🗂️ **Static file serving** — streams `dist/` with correct MIME types, ETag, and cache headers
- 🌐 **API routes** — serves `/api/*` from your `src/app/api/` handlers (Hono apps + plain functions)
- 🔀 **SPA fallback** — unknown routes serve `dist/index.html`
- 🌿 **Auto env loading** — `.env` loaded automatically via [bini-env](https://www.npmjs.com/package/bini-env)
- 🏷️ **ETag support** — `304 Not Modified` responses for unchanged files
- 🛡️ **CORS** — enabled by default on all API responses
- ⏱️ **Timeouts** — 30s body read timeout + 30s handler timeout
- 🔒 **Body limit** — 10MB request body limit
- 🔌 **Port auto-increment** — starts at `3000`, increments if busy
- 🪄 **Graceful shutdown** — handles `SIGTERM` + `SIGINT` with 10s force-exit fallback
- 🖥️ **Cross-platform** — works on Windows, macOS, and Linux

---

## Requirements

- Node.js **≥ 18**
- A [bini-router](https://www.npmjs.com/package/bini-router) project with a built `dist/`

---

## Install

```bash
npm install bini-server
```

---

## Usage

Add to your `package.json`:

```json
{
  "scripts": {
    "build": "vite build",
    "start": "bini-server"
  }
}
```

Then:

```bash
npm run build   # build your app
npm start       # serve it in production
```

Terminal output:

```
  ß Bini.js (production)

  ➜  Environments: .env
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.1.5:3000/
```

---

## Environment Variables

`.env` is loaded automatically at startup — all vars are available in `process.env` in your API handlers with no imports needed.

```env
PORT=3000
SMTP_USER=user@smtp.example.com
SMTP_PASS=your_password
```

---

## Important: ship your `src/` folder

bini-server runs your API handlers directly from `src/app/api/` — they are **not** compiled into `dist/`. When deploying, make sure your server has access to both `dist/` and `src/app/api/`.

For VPS/pm2 this means deploying your full project directory, not just `dist/`. For Railway, Render, and Fly.io this happens automatically since they clone your repository.

---

## Port

Default port is `3000`. Override via `.env` or inline:

```env
PORT=8080
```

```bash
PORT=8080 bini-server
```

If the port is busy, bini-server automatically increments and warns:

```
  ⚠  Port 3000 is in use, using port 3001 instead.
```

---

## Configurable Directories

By default bini-server reads from `src/app/api/` and `dist/`. Override via env vars:

```env
BINI_API_DIR=src/api        # default: src/app/api
BINI_DIST_DIR=build         # default: dist
```

---

## Deployment

### VPS (Ubuntu, Debian, etc.)

```bash
npm run build
npm start
```

Use [pm2](https://pm2.keymetrics.io/) to keep it running:

```bash
npm install -g pm2
pm2 start "npm start" --name my-app
pm2 save
pm2 startup
```

### Railway

Set start command to `npm start`. Railway injects `PORT` automatically.

### Render

Set start command to `npm start`. Render injects `PORT` automatically.

### Fly.io

```toml
# fly.toml
[processes]
  app = "npm start"
```

---

## vs `vite preview`

| Feature | `vite preview` | `bini-server` |
|---|---|---|
| Serves `dist/` | ✅ | ✅ |
| API routes | ✅ | ✅ |
| SPA fallback | ✅ | ✅ |
| Auto env loading | ✅ | ✅ |
| ETag / 304 support | ❌ | ✅ |
| Production use | ❌ | ✅ |
| Body timeout | ❌ | ✅ 30s |
| Body size limit | ❌ | ✅ 10MB |
| Handler timeout | ❌ | ✅ 30s |
| Graceful shutdown | ❌ | ✅ |
| Configurable dirs | ❌ | ✅ |
| Zero dependencies | ✅ | ✅ |

---

## License

MIT © [Binidu Ranasinghe](https://bini.js.org)