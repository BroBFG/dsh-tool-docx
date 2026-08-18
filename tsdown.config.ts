import { defineConfig } from 'tsdown'

/**
 * Bundle the tsc-emitted ESM into the package entry files. Mirrors the
 * deepseek-harness workspace build for this package: `lib/index.js` and
 * `lib/invariant.js` are the shipped entries; declarations stay in
 * `lib/types/**\/*.d.ts` (produced by `tsc -p tsconfig.json`).
 */
export default defineConfig({
  entry: [
    'lib/types/index.js',
    'lib/types/fs-binary-local.js',
    'lib/types/fs-binary-sandbox.js',
    'lib/types/fs-binary-local-plugin.js',
    'lib/types/fs-binary-sandbox-plugin.js',
    'lib/types/invariant.js',
  ],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  // The binary providers share the byte-write body, so tsdown emits one
  // hashed chunk (e.g. lib/fs-binary-local-<hash>.js); the package `files`
  // list ships `lib/*.js` to include it.
  // Keep the `.js` extension of the tsc-emitted entries (matching the
  // published package layout) instead of renaming to `.mjs`.
  fixedExtension: false,
})
