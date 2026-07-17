import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // CJS, not ESM: bundling ts-morph (transitively, via @mlensit/analyzer)
  // pulls in the TypeScript compiler's own CJS module, which does a
  // conditional `require("fs")` for Node feature detection. esbuild's
  // CJS-in-ESM interop shim can't satisfy a dynamic require of a Node
  // builtin in ESM output ("Dynamic require ... is not supported"), but
  // CJS output uses Node's real `require`, which handles it natively —
  // the same reason packages/vscode-extension and packages/github-action
  // both bundle to CJS despite this being an otherwise all-ESM monorepo.
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // tsup externalizes anything listed in package.json's dependencies by
  // default. The @mlensit/* workspace packages and commander are never
  // published on their own, so they must be inlined into the published
  // bundle rather than left as runtime imports a real npm install could
  // never resolve — the same reason packages/vscode-extension and
  // packages/github-action fully bundle their own entrypoints.
  noExternal: [/^@mlensit\//, 'commander'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
