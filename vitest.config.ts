import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The canvas engine is pure TypeScript (no React, no DOM), so the test
 * environment is `node`. The `@/*` alias mirrors the one in `tsconfig.json`
 * so tests import modules exactly like the app does.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
