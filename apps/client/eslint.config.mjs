import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore marks a value that is unused on purpose.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    rules: {
      // Phase 9 of the component-folder refactor switches this to "error".
      "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
      // Import a component's children, logic and assets through its barrels, never past them.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(?:^|(?<!^@)/)(?:components|workflow)/[^/]+",
              message:
                "Import from the `components` or `workflow` barrel (index.ts), not from a file or folder inside it.",
            },
            {
              regex: "^(?!\\./assets/).*(?:^|/)assets/",
              message: "Only the owning component imports its `assets/`; others import what its index re-exports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: { "max-lines": "off" },
  },
  {
    // Message dictionaries are data, kept whole so en/uk parity is easy to review.
    files: ["src/i18n/en.ts", "src/i18n/uk.ts"],
    rules: { "max-lines": "off" },
  },
  {
    // Not migrated to component folders yet (removed in phase 9).
    files: ["src/components/pages/casualties/**"],
    rules: { "no-restricted-imports": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright builds the client here (NEXT_DIST_DIR=.next-e2e).
    ".next-e2e/**",
  ]),
]);

export default eslintConfig;
