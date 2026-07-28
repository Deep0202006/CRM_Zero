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
    "next-env.d.ts", ".agents/**", ".codex-artifacts/**", "coverage/**",
    "temp_redesign/**",
    "check.js", "check_active.js", "check_caps.js", "check_cols.js", "check_users.js", "check_users_paginated.js", "check_visits.js",
    "scripts/seed-production-users.js",
  ]),
  // Downgrade React Compiler optimization hints to warnings.
  // These rules flag valid setState-before-async and manual useMemo patterns
  // that are intentional in the approved redesign.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;

