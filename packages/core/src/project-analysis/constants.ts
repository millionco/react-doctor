export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".es6",
  ".mdx",
  ".astro",
  ".graphql",
  ".gql",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
];

export const LEGACY_GRAPH_ONLY_PATTERNS = ["**/*.es6"];

export const STANDALONE_PROJECT_LOCKFILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
];

export const MONOREPO_ROOT_MARKERS = [
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  "lerna.json",
  "nx.json",
  "turbo.json",
  "rush.json",
];

export const LOCKFILE_MARKERS = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lockb",
  "bun.lock",
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
export const SOURCE_FALLBACK_OUTPUT_DIRECTORIES = [...OUTPUT_DIRECTORIES, "lib"];

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

export const DEFAULT_ENTRY_GLOBS = [
  "src/index.{ts,tsx,js,jsx}",
  "src/main.{ts,tsx,js,jsx}",
  "index.{ts,tsx,js,jsx}",
  "main.{ts,tsx,js,jsx}",
];

export const UNUSED_FILE_INCOMPLETE_CONTAINER_EXTENSIONS = [".astro", ".mdx", ".svelte", ".vue"];

export const UNUSED_FILE_UNSUPPORTED_FRAMEWORK_DEPENDENCIES = ["electron", "expo", "react-native"];

export const EXPO_CONFIG_SCAN_MAX_DEPTH = 6;

export const GRAPHQL_CODEGEN_CONFIG_SCAN_MAX_DEPTH = 6;

export const BUILD_SCRIPT_PACKAGE_SCAN_MAX_DEPTH = 6;

export const BUILD_SCRIPT_DIRECTORY_SCAN_MAX_DEPTH = 8;

export const GENERATED_SOURCE_HEADER_CHARACTERS = 4096;

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
  "gatsby-config.",
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
  "i18next-parser.config.",
  "codegen.config.",
  "codegen.",
  "codegen-",
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

export const REACT_NATIVE_ADDITIONAL_PLATFORM_SUFFIXES = [".rn"];

export const TARO_PLATFORM_SUFFIXES = [
  ".rn",
  ".h5",
  ".weapp",
  ".alipay",
  ".swan",
  ".tt",
  ".qq",
  ".jd",
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

export const TOOLING_SOURCE_MAX_DEPTH = 8;

export const MAX_CYCLES_PER_SCC = 20;

export const MAX_TOTAL_CYCLES = 200;

export const MAX_SCC_SIZE_FOR_ENUMERATION = 50;

export const MAX_PARSE_FILE_SIZE_BYTES = 2_000_000;

export const MAX_ERROR_DETAIL_LENGTH = 1000;

export const BINARY_DETECTION_SAMPLE_BYTES = 2048;

export const BINARY_DETECTION_NULL_BYTE_THRESHOLD = 4;

export const MINIFIED_DETECTION_MIN_BYTES = 5000;

export const MINIFIED_DETECTION_MEDIAN_LINE_LENGTH_THRESHOLD = 500;

export const GIT_CHECK_IGNORE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
