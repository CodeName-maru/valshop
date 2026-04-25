/**
 * ESLint Configuration (plan 0024 Phase 3)
 * - no-console: error globally (whitelisted files excluded)
 * - Uses flat config format (ESLint 9+)
 */

import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  // Base ignores
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "build/**",
      "coverage/**",
    ],
  },

  // TypeScript config (relaxed for existing code)
  ...tseslint.configs.strictTypeChecked,

  // Apply Next.js plugin
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },

  // Global rules
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Phase 3: no-console globally (error)
      "no-console": "error",

      // Existing code has these issues - relax for now
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/require-await": "warn",
    },
  },

  // Overrides: Whitelist files where console is allowed
  {
    files: [
      "lib/logger.ts", // Logger internal implementation
      "scripts/**/*", // Development scripts
      "**/*.test.ts", // Test files
      "**/*.test.tsx", // Test files
      "tests/**/*", // All test files
      "vitest.config.ts", // Vitest config
      "playwright.config.ts", // Playwright config
    ],
    rules: {
      "no-console": "off",
    },
  },
];
