import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    dts: false,
    shims: false,
    outExtension() {
      return { js: '.js' };
    },
    external: ['bini-env', 'bini-env/node', 'bini-router', 'hono', 'hono/adapter'],
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    outDir: 'dist',
    clean: false,
    splitting: false,
    sourcemap: true,
    dts: true,
    shims: false,
    outExtension() {
      return { js: '.js' };
    },
    external: ['bini-env', 'bini-env/node', 'bini-router', 'hono', 'hono/adapter'],
  },
]);