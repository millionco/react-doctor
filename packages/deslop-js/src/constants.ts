export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".mdx",
  ".astro",
  ".graphql",
  ".gql",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
];

export const HIDDEN_DIRECTORY_ALLOWLIST = [
  ".storybook",
  ".vitepress",
  ".well-known",
  ".changeset",
  ".github",
  ".client",
  ".server",
];

export const OUTPUT_DIRECTORIES = ["dist", "build", "out", "esm", "cjs"];

export const SOURCE_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

export const DEFAULT_EXCLUSIONS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.js",
  "**/*.min.mjs",
  "**/mockServiceWorker.js",
];

export const SCRIPT_FILE_PATTERN =
  /(?:^|\s)(?:node|tsx|ts-node|tsc|npx|bun|esr|esno|jiti|babel-node|zx)\s+(?:\S+\s+)*?([\w./@-]+\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs))(?:\s|$)/;

export const SCRIPT_EXTENSIONLESS_FILE_PATTERN =
  /(?:^|\s)(?:node|tsx|ts-node|bun|esr|esno|jiti|babel-node|zx)\s+(?:\S+\s+)*?((?:[./]|[\w@][\w@-]*\/)[\w./@-]+)(?:\s|$)/;

export const SCRIPT_CONFIG_FILE_PATTERN =
  /--config\s+([\w./@-]+\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs))/;

export const SCRIPT_ENTRY_PATTERNS: string[] = [];

export const DEFAULT_ENTRY_GLOBS = [
  "src/index.{ts,tsx,js,jsx}",
  "src/main.{ts,tsx,js,jsx}",
  "index.{ts,tsx,js,jsx}",
  "main.{ts,tsx,js,jsx}",
];

export const EXPO_CONFIG_SCAN_MAX_DEPTH = 6;

export const KNOWN_CONFIG_PREFIXES = [
  "babel.config.",
  "rollup.config.",
  "webpack.config.",
  "postcss.config.",
  "stencil.config.",
  "remotion.config.",
  "metro.config.",
  "tsup.config.",
  "tsdown.config.",
  "unbuild.config.",
  "esbuild.config.",
  "swc.config.",
  "turbo.",
  "jest.config.",
  "jest.setup.",
  "vitest.config.",
  "vitest.ci.config.",
  "vitest.setup.",
  "vitest.workspace.",
  "playwright.config.",
  "cypress.config.",
  "karma.conf.",
  "eslint.config.",
  "prettier.config.",
  "stylelint.config.",
  "lint-staged.config.",
  "commitlint.config.",
  "next.config.",
  "next-sitemap.config.",
  "nuxt.config.",
  "astro.config.",
  "sanity.config.",
  "vite.config.",
  "tailwind.config.",
  "drizzle.config.",
  "knexfile.",
  "sentry.client.config.",
  "sentry.server.config.",
  "sentry.edge.config.",
  "react-router.config.",
  "typedoc.",
  "deslop.config.",
  "i18next-parser.config.",
  "codegen.config.",
  "graphql.config.",
  "npmpackagejsonlint.config.",
  "release-it.",
  "release.config.",
  "contentlayer.config.",
  "rspack.config.",
  "rsbuild.config.",
  "module-federation.config.",
  "vercel.",
  "next-env.d.",
  "env.d.",
  "vite-env.d.",
];

export const IMPLICIT_DEPENDENCIES = new Set([
  "typescript",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "eslint",
  "prettier",
  "husky",
  "lint-staged",
  "tslib",
  "@babel/core",
  "@babel/runtime",
  "babel-core",
  "babel-jest",
  "babel-loader",
  "postcss",
  "cross-env",
  "sass",
  "node-sass",
  "less",
  "oxlint",
  "biome",
  "@biomejs/biome",
  "patch-package",
  "simple-git-hooks",
  "lefthook",
  "ts-node",
  "ts-jest",
  "tsx",
  "jsdom",
  "rimraf",
  "concurrently",
  "npm-run-all",
  "npm-run-all2",
  "dotenv-cli",
  "webpack",
  "rollup",
  "terser",
  "autoprefixer",
  "tailwindcss",
  "react-test-renderer",
  "esbuild",
  "typedoc",
  "commitizen",
  "cz-conventional-changelog",
]);

export const BUILTIN_MODULES = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

export const PLATFORM_SUFFIXES = [
  ".web",
  ".react-native",
  ".native",
  ".ios",
  ".android",
  ".desktop",
  ".windows",
  ".macos",
  ".any",
  ".react-server",
  ".server",
  ".client",
];

export const REACT_NATIVE_PLATFORM_EXTENSIONS = [
  ".web.ts",
  ".web.tsx",
  ".web.js",
  ".web.jsx",
  ".native.ts",
  ".native.tsx",
  ".native.js",
  ".native.jsx",
  ".ios.ts",
  ".ios.tsx",
  ".ios.js",
  ".ios.jsx",
  ".android.ts",
  ".android.tsx",
  ".android.js",
  ".android.jsx",
];

export const RESOLVER_EXTENSIONS = [
  ...DEFAULT_EXTENSIONS,
  ".d.ts",
  ".d.mts",
  ".d.cts",
  ".json",
  ".node",
  ".css",
  ".scss",
  ".less",
  ".svg",
  ".png",
  ".jpg",
  ".graphql",
  ".gql",
];

export const SHALLOW_WORKSPACE_MAX_DEPTH = 2;

export const MAX_CYCLES_PER_SCC = 20;

export const MAX_TOTAL_CYCLES = 200;

export const MAX_SCC_SIZE_FOR_ENUMERATION = 50;

export const SEMANTIC_MAX_PROGRAM_FILES = 5000;

export const MAX_PARSE_FILE_SIZE_BYTES = 2_000_000;

export const MAX_AST_WALK_DEPTH = 200;

export const MAX_TYPE_REFERENCE_WALK_DEPTH = 6;

export const MAX_EXPRESSION_DETECTOR_WALK_DEPTH = 100;

export const MAX_FUNCTION_BODY_INSPECT_DEPTH = 30;

export const MAX_TYPE_CONTEXT_PARENT_WALK = 12;

export const MAX_ANALYSIS_ERRORS = 5000;

export const MAX_ERROR_DETAIL_LENGTH = 1000;

export const BINARY_DETECTION_SAMPLE_BYTES = 2048;

export const BINARY_DETECTION_NULL_BYTE_THRESHOLD = 4;

export const MINIFIED_DETECTION_MIN_BYTES = 5000;

export const MINIFIED_DETECTION_AVG_LINE_LENGTH_THRESHOLD = 500;

export const MIN_FILES_FOR_DUPLICATE_CONSTANT = 3;

export const MIN_PROPERTIES_FOR_INLINE_TYPE_LITERAL = 3;

/**
 * Strings shorter than this are mostly noise (`""`, `"id"`, `"name"`,
 * single-word config keys) and trigger many cross-file coincidental matches
 * that aren't real DRY violations. 8 chars roughly excludes single common
 * words but still catches URLs, error codes, and identifiers worth extracting.
 * Tuned for low FP rate, not corpus-tuned to a specific metric target.
 */
export const MIN_STRING_LITERAL_LENGTH_FOR_DUPLICATE = 8;

/**
 * Numeric literals below 1000 are dominated by indices, counters, small
 * ranges, ports, percentages, and array sizes that coincide by accident
 * (every `MAX_RETRIES = 3` is not a duplicate of every `LIMIT = 3`).
 * 1000 admits real shared constants (timeouts in ms, byte sizes, polling
 * intervals) without producing the noise floor that smaller magnitudes do.
 * NOTE: even at 1000, the rule still produces medium-confidence false
 * positives when constants share a value coincidentally with different
 * names (e.g. `STEP_DELAY_MS` vs `MINIMUM_TOKENS`); the report explicitly
 * downgrades those to `confidence: "medium"`.
 */
export const MIN_NUMERIC_LITERAL_MAGNITUDE_FOR_DUPLICATE = 1000;

export const INLINE_TYPE_PREVIEW_KEYS = 4;

export const SIMPLIFIABLE_EXPRESSION_MEMBER_ACCESS_DEPTH = 6;

export const ANALYSIS_ERROR_PRINT_LIMIT = 20;

export const DUPLICATE_INLINE_TYPE_HIGH_MEMBER_COUNT = 5;

export const SEMANTIC_PROGRAM_BUDGET_MS = 30_000;

export const SEMANTIC_TRACE_MAX_ENTRIES = 5;

export const DEFAULT_DUPLICATE_BLOCK_MIN_TOKENS = 50;

export const DEFAULT_DUPLICATE_BLOCK_MIN_LINES = 5;

export const DEFAULT_DUPLICATE_BLOCK_MIN_OCCURRENCES = 2;

export const DUPLICATE_BLOCK_MODULE_EXTRACTION_THRESHOLD_LINES = 50;

export const SHADOWED_DIRECTORY_MIN_CLUSTERS = 3;

export const DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST = [
  "Component",
  "Injectable",
  "NgModule",
  "Pipe",
  "Directive",
  "Controller",
  "Module",
  "Resolver",
  "Query",
  "Mutation",
  "Get",
  "Post",
  "Put",
  "Patch",
  "Delete",
  "Head",
  "Options",
  "All",
  "Sse",
  "WebSocketGateway",
  "SubscribeMessage",
];

export const DEFAULT_SEMANTIC_TSCONFIG_NAMES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.build.json",
  "tsconfig.src.json",
  "jsconfig.json",
];

export const DEFAULT_CYCLOMATIC_THRESHOLD = 10;

export const DEFAULT_COGNITIVE_THRESHOLD = 15;

export const DEFAULT_PARAM_COUNT_THRESHOLD = 5;

export const DEFAULT_FUNCTION_LINE_THRESHOLD = 80;

export const PARALLEL_PARSE_FILE_THRESHOLD = 50;

export const MIN_PARSE_CONCURRENCY = 1;

export const MAX_PARSE_CONCURRENCY = 16;

export const GIT_CHECK_IGNORE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
