import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Convex-generated code (types + component loaders) is never hand-edited;
    // ignoring it stops its warnings from masking real ones.
    "convex/_generated/**",
    "convex/betterAuth/_generated/**",
  ]),
]);

export default eslintConfig;
