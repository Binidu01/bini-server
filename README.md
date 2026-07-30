# bini-server

<div align="center">

[![npm version](https://img.shields.io/npm/v/bini-server?style=flat-square&logo=npm&logoColor=white&label=npm&color=CB3837&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square&logo=opensourceinitiative&logoColor=white&labelColor=0a0a0a)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white&labelColor=0a0a0a)](https://nodejs.org)
[![bundle size](https://img.shields.io/bundlephobia/min/bini-server?style=flat-square&logo=npm&labelColor=0a0a0a)](https://bundlephobia.com/package/bini-server)
[![downloads](https://img.shields.io/npm/dt/bini-server?style=flat-square&logo=npm&labelColor=0a0a0a)](https://www.npmjs.com/package/bini-server)

**Production server for [bini-router](https://www.npmjs.com/package/bini-router) apps.**  
Zero-dependency, secure-by-default, production-grade server for your static sites and API routes.

</div>

---

## ✨ Features

### Core Features
- 🗂️ **Static file serving** — Streams `dist/` with proper MIME types, ETag, and cache headers
- 🌐 **API routes** — Serves `/api/*` from `src/app/api/` (Hono apps + plain functions)
- 🔀 **SPA fallback** — Unknown routes serve `dist/index.html` automatically
- 🏷️ **ETag support** — `304 Not Modified` responses for unchanged static files
- ⚡ **Lazy route loading** — API routes scanned only on first request for fast startup

### Security & Performance
- 🛡️ **CORS** — Enabled by default, configurable via `CORS_ENABLED` (supports `BINI_*`, `VITE_*`, no prefix)
- 🔒 **Body limits** — Configurable request body size limit (default 10MB)
- ⏱️ **Timeouts** — Configurable body read + handler timeouts (default 30s each)
- 🚫 **Path traversal protection** — Guards against `..` and `//` in URLs
- 💾 **Module cache** — Caches imported handlers with mtime invalidation
- 🔌 **Port auto-increment** — Starts at `3000`, auto-increments if busy

### Developer Experience
- 🌿 **Auto env loading** — `.env` files detected and listed at startup
- ⌨️ **Interactive shortcuts** — `h` for help, `o` to open browser, `q` to quit
- 🖥️ **Cross-platform** — Works on Windows, macOS, and Linux
- 🪄 **Graceful shutdown** — Handles `SIGTERM` + `SIGINT` with timeout fallback
- 📦 **Zero dependencies** — Only uses Node.js built-in modules
- 🔧 **Flexible config** — Supports `BINI_*`, `VITE_*`, or no prefix env vars

---

## 📋 Requirements

- Node.js **≥ 20.19.0**
- A [bini-router](https://www.npmjs.com/package/bini-router) project with a built `dist/`
- API handlers in `src/app/api/` (if using API routes)

---

## 📦 Install

```bash
npm install bini-server
# or
pnpm add bini-server
# or
yarn add bini-server
```

---

## 🚀 Usage

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

```
  ß Bini.js  (production)
  ➜  Environments: .env, .env.local
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.1.5:3000/
  ➜  press h + enter to show help
```

---

## ⌨️ Keyboard Shortcuts

While the server is running, type a key and press `enter`:

| Key | Action |
|-----|--------|
| `h` | Show available shortcuts |
| `o` | Open your app in the default browser |
| `q` | Quit the server |

> Keyboard shortcuts are automatically disabled in non-interactive environments (like Render, CI/CD).

---

## 🌿 Environment Variables

### Auto-Detected `.env` Files

At startup, bini-server automatically detects and loads:

1. `.env.local`
2. `.env.[NODE_ENV].local` (e.g., `.env.production.local`)
3. `.env.[NODE_ENV]` (e.g., `.env.production`)
4. `.env`

All detected files are listed in the startup banner.

### Server Configuration

All environment variables support **three naming conventions:**

| Convention | Example | Priority |
|------------|---------|----------|
| `BINI_*` | `BINI_PORT=3000` | Highest |
| `VITE_*` | `VITE_PORT=3000` | Medium |
| No prefix | `PORT=3000` | Lowest |

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `CORS_ENABLED` | `true` | Enable/disable CORS on API routes |
| `API_DIR` | `src/app/api` | Path to API handlers directory |
| `DIST_DIR` | `dist` | Path to static files directory |
| `BODY_TIMEOUT_SECS` | `30` | Max seconds to read request body |
| `HANDLER_TIMEOUT_SECS` | `30` | Max seconds for handler to respond |
| `BODY_SIZE_LIMIT` | `10485760` | Max request body size in bytes (10MB) |

### Examples

```bash
# .env file
PORT=8080
CORS_ENABLED=false
API_DIR=src/api
BODY_SIZE_LIMIT=5242880  # 5MB

# Or inline
PORT=3001 BINI_CORS_ENABLED=false bini-server

# Or with VITE prefix
VITE_PORT=3000 VITE_CORS_ENABLED=false bini-server
```

---

## 📁 Project Structure

```
my-app/
├── dist/                    # Built static files (required)
│   ├── index.html
│   ├── assets/
│   └── ...
├── src/
│   ├── app/
│   │   ├── api/            # API handlers (optional)
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

## 🌐 API Routes

### Supported Formats

```typescript
// 1. Hono App (Recommended)
import { Hono } from 'hono';
const app = new Hono();
app.get('/users', (c) => c.json({ users: [] }));
export default app;

// 2. Plain Function
export default (req: Request) => {
  return Response.json({ message: 'Hello' });
};
```

### Supported Extensions

Only `.ts` and `.js` files are supported for API routes (Next.js convention).

### Dynamic Routes

```
src/app/api/
  users/
    [id].ts      → /api/users/:id
  posts/
    [...slug].ts → /api/posts/*
```

### Route Parameters

```typescript
// src/app/api/users/[id].ts
export default (req: Request) => {
  const params = JSON.parse(req.headers.get('x-bini-params') || '{}');
  // params.id → '123'
  return Response.json({ id: params.id });
};
```

### CORS

CORS is **enabled by default** with these headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD
Access-Control-Allow-Headers: Content-Type,Authorization,X-Request-ID
```

Disable with `CORS_ENABLED=false`, `BINI_CORS_ENABLED=false`, or `VITE_CORS_ENABLED=false`.

---

## 🗂️ Static File Serving

### Supported MIME Types

All common file types are served with correct MIME types:
- HTML, CSS, JavaScript, JSON
- Images: PNG, JPEG, GIF, SVG, WebP, AVIF, ICO
- Fonts: WOFF, WOFF2, TTF, EOT
- Documents: TXT, XML
- Web manifests

### Cache Headers

| File Type | Cache Policy |
|-----------|--------------|
| **Assets** (`/assets/*`) | `public, max-age=31536000, immutable` (1 year) |
| **All other files** | `no-cache` |

### ETag Support

Automatically generates ETags from file `size + mtimeMs`:
- Sends `ETag` header on first request
- Handles `If-None-Match` for `304 Not Modified` responses
- Uses MD5 hash (16 chars) for efficient caching

---

## 🚢 Deployment

### Important: Ship Your `src/` Folder

bini-server runs API handlers directly from `src/app/api/` — they are **not** compiled into `dist/`. When deploying, ensure your server has access to both `dist/` and `src/app/api/`.

- ✅ **VPS/pm2**: Deploy the full project directory
- ✅ **Railway/Render/Fly.io**: Automatic (clones your repository)
- ✅ **Docker**: Copy both `dist/` and `src/` directories

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
|----------|---------------|-------|
| **Railway** | `npm start` | PORT injected automatically |
| **Render** | `npm start` | PORT injected automatically |
| **Fly.io** | `npm start` | See fly.toml example below |
| **Heroku** | `npm start` | PORT injected automatically |

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN npm run build
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

## 🔧 vs `vite preview`

| Feature | `vite preview` | `bini-server` |
|---------|---------------|---------------|
| Serves `dist/` | ✅ | ✅ |
| API routes | ✅ | ✅ |
| SPA fallback | ✅ | ✅ |
| Auto env loading | ✅ | ✅ |
| ETag / 304 support | ❌ | ✅ |
| Body timeout | ❌ | ✅ (30s) |
| Body size limit | ❌ | ✅ (10MB) |
| Handler timeout | ❌ | ✅ (30s) |
| Graceful shutdown | ❌ | ✅ |
| Module cache | ❌ | ✅ |
| Configurable dirs | ❌ | ✅ |
| CORS control | ❌ | ✅ |
| Zero dependencies | ❌ | ✅ |
| Production use | ⚠️ Not recommended | ✅ Production-ready |

---

## 🛡️ Security

| Feature | Default | Configurable |
|---------|---------|--------------|
| CORS | Enabled | ✅ via `CORS_ENABLED` |
| Body size limit | 10MB | ✅ via `BODY_SIZE_LIMIT` |
| Request timeout | 30s | ✅ via `BODY_TIMEOUT_SECS` |
| Handler timeout | 30s | ✅ via `HANDLER_TIMEOUT_SECS` |
| Path traversal | Blocked | ✅ (guard in place) |

---

## 🧪 Testing Your Server

```bash
# Check static files
curl http://localhost:3000/

# Check API routes
curl http://localhost:3000/api/hello

# Check ETag
curl -I http://localhost:3000/styles.css

# Test 304 Not Modified
curl -I http://localhost:3000/styles.css \
  -H "If-None-Match: [etag_from_previous_request]"

# Test CORS
curl -X OPTIONS http://localhost:3000/api/hello \
  -H "Origin: http://example.com"
```

---

## ⚙️ Configuration Examples

### Development (All security disabled)
```bash
CORS_ENABLED=true
BODY_TIMEOUT_SECS=0
HANDLER_TIMEOUT_SECS=0
BODY_SIZE_LIMIT=0
NODE_ENV=development
```

### Production (Secure defaults)
```bash
CORS_ENABLED=true
BODY_TIMEOUT_SECS=30
HANDLER_TIMEOUT_SECS=30
BODY_SIZE_LIMIT=10485760
NODE_ENV=production
```

### Internal API (No CORS)
```bash
CORS_ENABLED=false
BODY_SIZE_LIMIT=5242880  # 5MB
```

### File Upload Service
```bash
CORS_ENABLED=true
BODY_SIZE_LIMIT=1073741824  # 1GB
BODY_TIMEOUT_SECS=300  # 5 minutes
```

---

## 📚 API Reference

### Environment Variables Priority

1. `BINI_*` (highest)
2. `VITE_*` (medium)
3. No prefix (lowest)

### Returned HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `204` | OPTIONS preflight success |
| `304` | Not Modified (ETag match) |
| `400` | Bad Request URL |
| `404` | Route not found |
| `408` | Request timeout |
| `413` | Payload too large |
| `500` | Internal server error |

### Supported HTTP Methods

- `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
- `OPTIONS` (CORS preflight)
- `HEAD` (with ETag support)

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📝 License

MIT © [Binidu Ranasinghe](https://bini.js.org)

---

## 🔗 Links

- [GitHub](https://github.com/Binidu01/bini-server)
- [npm](https://www.npmjs.com/package/bini-server)
- [Bini.js](https://bini.js.org)
- [Issues](https://github.com/Binidu01/bini-server/issues)

---

<div align="center">

**Built with ❤️ by [Binidu Ranasinghe](https://github.com/Binidu01)**

</div>
