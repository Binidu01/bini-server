import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry    : { cli: 'src/cli.ts' },
    format   : ['esm'],
    target   : 'node22',
    platform : 'node',
    outDir   : 'dist',
    clean    : true,
    splitting: false,
    sourcemap: false,
    dts      : false,
    shims    : false,
  },
  {
    entry    : { index: 'src/index.ts' },
    format   : ['esm'],
    target   : 'node22',
    platform : 'node',
    outDir   : 'dist',
    clean    : false,
    splitting: false,
    sourcemap: false,
    dts      : false,
    shims    : false,
  },
])