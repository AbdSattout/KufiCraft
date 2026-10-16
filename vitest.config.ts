import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Two Vitest projects:
 *
 * - `engine`: the pure canvas engine (`src/lib/canvas/**`) under `node` — it is
 *   pure TypeScript with no React and no DOM.
 * - `convex`: the backend contract tests (`convex/**`) under `edge-runtime`,
 *   the environment the Convex docs recommend for `convex-test` because it
 *   matches Convex's V8-like runtime much more closely than Node (the suite
 *   also passes under `node`). See
 *   https://docs.convex.dev/testing/convex-test.
 *
 * The `@/*` alias mirrors the one in `tsconfig.json` so tests import modules
 * exactly like the app does.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "engine",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
