# bini-server

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-server?style=flat-square&logo=npm&logoColor=white&label=npm&color=CB3837&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=0a0a0a)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=0a0a0a)](https://nodejs.org)
[![bini-env](https://img.shields.io/badge/bini--env-powered-00CFFF?style=flat-square&logo=vite&logoColor=white&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-env)

**Production server for [bini-router](https://www.npmjs.com/package/bini-router) apps.**  
Serves your `dist/` statically and handles `/api/*` from your `src/app/api/` handlers — just like `vite preview`, but production-grade.

</div>

---

## Features

- 🗂️ **Static file serving** — streams `dist/` with correct MIME types, ETag, and cache headers
- 🌐 **API routes** — serves `/api/*` from your `src/app/api/` handlers (Hono apps + plain functions)
- 🔀 **SPA fallback** — unknown routes serve `dist/index.html`
- 🌿 **Auto env loading** — `.env` loaded automatically via [bini-env](https://www.npmjs.com/package/bini-env)
- 🏷️ **ETag support** — `304 Not Modified` responses for unchanged files
- 🛡️ **CORS** — enabled by default on all API responses
- ⏱️ **Timeouts** — configurable body read + handler timeouts (default 30s each)
- 🔒 **Body limit** — configurable request body limit (default 10MB)
- 🔌 **Port auto-increment** — starts at `3000`, increments if busy
- 🪄 **Graceful shutdown** — handles `SIGTERM` + `SIGINT` with 10s force-exit fallback
- ⌨️ **Interactive keyboard shortcuts** — `h` for help, `o` to open in browser, `q` to quit
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
  ß Bini.js  (production)
  ➜  Environments: .env
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.1.5:3000/
  ➜  press h + enter to show help
```

---

## Keyboard Shortcuts

Once the server is running, type a key and press `enter`:

| Key | Action |
|-----|--------|
| `h` | Show available shortcuts |
| `o` | Open in browser |
| `q` | Quit |

---

## Environment Variables

`.env` is loaded automatically at startup — all vars are available in `process.env` in your API handlers with no imports needed.

```env
PORT=3000
SMTP_USER=user@smtp.example.com
SMTP_PASS=your_password
```

### Server Configuration

These variables tune server behaviour and can be set in `.env` or inline:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port to listen on |
| `BINI_API_DIR` | `src/app/api` | Path to API handlers directory |
| `BINI_DIST_DIR` | `dist` | Path to static files directory |
| `BINI_BODY_TIMEOUT_SECS` | `30` | Max seconds to read request body |
| `BINI_HANDLER_TIMEOUT_SECS` | `30` | Max seconds for an API handler to respond |
| `BINI_BODY_SIZE_LIMIT` | `10485760` | Max request body size in bytes (default 10MB) |

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
  ⚠  Port 3000 in use — using 3001 instead.
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
| Keyboard shortcuts | ❌ | ✅ |
| Configurable dirs | ❌ | ✅ |

---

## License

MIT © [Binidu Ranasinghe](https://bini.js.org)