# bini-server

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-server?color=00CFFF&labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-server)
[![license](https://img.shields.io/badge/license-MIT-00CFFF?labelColor=0a0a0a&style=flat-square)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-00CFFF?labelColor=0a0a0a&style=flat-square)](https://nodejs.org)
[![bini-env](https://img.shields.io/badge/bini--env-powered-00CFFF?labelColor=0a0a0a&style=flat-square)](https://www.npmjs.com/package/bini-env)

**Zero-dependency production server for [bini-router](https://www.npmjs.com/package/bini-router) apps.**  
Serves your `dist/` statically and proxies `/api/*` to your `src/app/api/` handlers — just like Vite's preview server, but for production.

</div>

---

## Features

- ⚡ **Zero dependencies** — pure Node.js built-ins only
- 🗂️ **Static file serving** — streams `dist/` with correct MIME types, ETag, and cache headers
- 🌐 **API routes** — proxies `/api/*` to your `src/app/api/` handlers (Hono apps + plain functions)
- 🔀 **SPA fallback** — unknown routes serve `dist/index.html`
- 🌿 **Auto env loading** — `.env` loaded automatically via [bini-env](https://www.npmjs.com/package/bini-env) — no dotenv setup needed
- 🏷️ **ETag support** — `304 Not Modified` responses for unchanged files
- 🛡️ **CORS** — enabled by default on all API responses
- ⏱️ **Timeouts** — 30s body read + 30s handler timeout with proper error responses
- 🔒 **Body limit** — 10MB request body limit
- 🔌 **Port auto-increment** — starts at 3000, increments if busy
- 🪄 **Graceful shutdown** — handles SIGTERM + SIGINT with 10s force-exit fallback
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

bini-server uses [bini-env](https://www.npmjs.com/package/bini-env) to automatically load `.env` before the server starts — no manual dotenv setup needed.

```env
# .env
PORT=3000

# Server-side vars — used by API routes via getEnv() / requireEnv()
SMTP_USER=user@smtp.example.com
SMTP_PASS=your_password
FROM_EMAIL=App <noreply@example.com>

# Client-side vars — already baked into dist/ at build time, ignored by server
BINI_FIREBASE_API_KEY=your_key
```

> Client-side `BINI_*` vars are baked into `dist/` at build time by Vite — bini-server loads them into `process.env` but never uses them. They don't cause any errors.

---

## How it works

bini-server runs a plain Node.js `http` server with a three-layer middleware stack:

```
Request
  │
  ├─ /api/*  →  src/app/api/ handlers  (Hono apps or plain functions)
  │
  ├─ /*      →  stream static file from dist/  (with ETag + cache headers)
  │
  └─ /*      →  dist/index.html                (SPA fallback)
```

No Vite, no Express, no Fastify — just Node's built-in `http` module.

---

## Port

Default port is `3000`. Override via environment variable:

```bash
PORT=8080 bini-server
```

Or in `.env`:

```env
PORT=8080
```

If the port is busy, bini-server automatically increments and warns:

```
  ⚠  Port 3000 is in use, using port 3001 instead.
```

---

## Configurable Directories

By default bini-server reads from `src/app/api/` and `dist/`. Override via env vars if your project uses a different structure:

```env
BINI_API_DIR=src/api        # default: src/app/api
BINI_DIST_DIR=build         # default: dist
```

---

## API Routes

bini-server reads `src/app/api/` directly — the same files your dev server uses. Both Hono apps and plain function handlers are supported. `getEnv` and `requireEnv` are auto-imported by bini-router so no imports needed:

```ts
// src/app/api/email.ts
import { Hono } from 'hono'
import nodemailer from 'nodemailer'

const app = new Hono().basePath('/api')

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  auth: {
    user: requireEnv('SMTP_USER'),  // auto-imported, throws if missing
    pass: requireEnv('SMTP_PASS'),
  },
})

app.post('/email', async (c) => {
  const { to, subject, html } = await c.req.json()
  await transporter.sendMail({ from: requireEnv('FROM_EMAIL'), to, subject, html })
  return c.json({ ok: true })
})

export default app
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

Set start command to `npm start` in your Railway project settings. Railway injects `PORT` automatically.

### Render

Set start command to `npm start`. Render injects `PORT` automatically.

### Fly.io

```toml
# fly.toml
[processes]
  app = "npm start"
```

---

## Project structure

bini-server expects the standard bini-router project layout:

```
my-app/
├── src/
│   └── app/
│       └── api/         ← API route handlers
├── dist/                ← built frontend (vite build output)
├── .env                 ← environment variables
└── package.json
```

---

## vs `vite preview`

| Feature | `vite preview` | `bini-server` |
|---|---|---|
| Serves `dist/` | ✅ | ✅ |
| API routes | ✅ via bini-router | ✅ via bini-router |
| SPA fallback | ✅ | ✅ |
| Auto env loading | ✅ via bini-env | ✅ via bini-env |
| ETag / 304 support | ❌ | ✅ |
| Production use | ❌ not recommended | ✅ |
| Body timeout | ❌ | ✅ 30s |
| Body size limit | ❌ | ✅ 10MB |
| Handler timeout | ❌ | ✅ 30s |
| Graceful shutdown | ❌ | ✅ |
| Configurable dirs | ❌ | ✅ |
| Zero dependencies | ✅ | ✅ |

---

## License

MIT © [Binidu Ranasinghe](https://bini.js.org)