import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Import a component's children, logic and assets through its barrels, never past them. */
const BARREL_PATTERNS = [
  {
    regex: "(?:^|(?<!^@)/)(?:components|workflow)/[^/]+",
    message: "Import from the `components` or `workflow` barrel (index.ts), not from a file or folder inside it.",
  },
  {
    regex: "^(?!\\./assets/).*(?:^|/)assets/",
    message: "Only the owning component imports its `assets/`; others import what its index re-exports.",
  },
];

/** Shared components serve several pages, so they never depend on one. */
const NO_PAGES = {
  regex: "^@/components/pages(?:/|$)|^(?:\\.\\./)+pages(?:/|$)",
  message: "`shared/` must not import from `pages/`; move what both need to `shared/` or `src/lib`.",
};

/** `no-restricted-imports` with the barrel rules plus `extra`. An override replaces the rule's options, so each repeats them. */
function restrictImports(...extra) {
  return ["error", { patterns: [...BARREL_PATTERNS, ...extra] }];
}

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
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "no-restricted-imports": restrictImports(),
    },
  },
  {
    files: ["src/components/shared/**"],
    rules: { "no-restricted-imports": restrictImports(NO_PAGES) },
  },
  {
    // The paper card gets its board-bound cells through the `PaperCells` slot (P2-027).
    files: ["src/components/shared/dd1380-card/**"],
    rules: {
      "no-restricted-imports": restrictImports(NO_PAGES, {
        regex: "^@/lib/board(?:/|$)|(?:^|/)lib/board(?:/|$)",
        message: "The DD1380 card must not use the board store; the page passes board-bound cells through `PaperCells`.",
      }),
    },
  },
  {
    // Generic presentational components: no domain types, no data or sync layer.
    files: ["src/components/ui/**"],
    rules: {
      "no-restricted-imports": restrictImports({
        regex: "^@tccc/shared(?:/|$)|^@/lib/(?:db|sync)(?:/|$)|(?:^|/)lib/(?:db|sync)(?:/|$)",
        message: "`ui/` holds generic components only: no `@tccc/shared`, `@/lib/db` or `@/lib/sync` (use `shared/` for domain components).",
      }),
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
