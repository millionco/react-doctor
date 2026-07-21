// Directory names that mark a file as part of a test / fixture /
// Storybook / Cypress / docs-site (`.dumi`) / example surface, regardless
// of the file's own suffix.
const NON_PRODUCTION_PATH_SEGMENTS: ReadonlyArray<string> = [
  "/test/",
  "/tests/",
  "/testing/",
  "/__tests__/",
  "/__test__/",
  "/__fixtures__/",
  "/fixtures/",
  "/__mocks__/",
  "/mocks/",
  "/testUtils/",
  "/test-utils/",
  "/testutils/",
  "/cypress/",
  "/playwright/",
  "/.storybook/",
  "/.dumi/",
  "/stories/",
  "/__stories__/",
  "/playground/",
  "/playgrounds/",
  "/examples/",
  "/example/",
  "/demo/",
  "/demos/",
  "/sandbox/",
  "/sandboxes/",
  "/e2e/",
  "/e2e-tests/",
  "/specs/",
  "/spec/",
  "/integration-tests/",
  "/integration/",
  "/it/",
  "/benchmarks/",
  "/benchmark/",
  "/__benchmarks__/",
  "/perf/",
  "/perf-tests/",
  // CLI / one-shot / build-time tooling — never shipped in the
  // user-facing bundle, no render-perf or React-rule concerns. Captures
  // top-level `scripts/`, `cli/`, `bin/`, `tooling/`, `tools/`,
  // `codemods/`, `migrations/`, `generators/`, `runbooks/`, etc. as well
  // as `src/scripts/...` shaped layouts.
  "/scripts/",
  "/cli/",
  "/bin/",
  "/tooling/",
  "/tools/",
  "/codemods/",
  "/codemod/",
  "/migrations/",
  "/migration/",
  "/generators/",
  "/generator/",
  "/runbooks/",
  "/devtools/",
  "/internal-tools/",
  "/seeds/",
  "/seed/",
  "/dev-seeder/",
];

// True iff `filename` looks like test / spec / Storybook / Cypress /
// benchmark / e2e / docs-demo code — by suffix (`.test.tsx`, `.spec.ts`,
// `.cy.tsx`, `.stories.tsx`, `.bench.ts`, `.e2e.ts`, `.story.ts`) or by sitting
// inside a recognized test/fixture directory. Used by rules whose
// findings are unactionable in non-production code (a11y rules, perf
// rules, Fast-Refresh-only-export rules) to skip those files entirely
// without forcing users to maintain explicit ignore lists.
const NON_PRODUCTION_FILENAME_SUFFIXES: ReadonlyArray<string> = [
  ".test.",
  ".spec.",
  ".cy.",
  ".stories.",
  ".story.",
  ".bench.",
  ".benchmark.",
  ".e2e.",
  ".integration-spec.",
  ".int-spec.",
  ".mock.",
  ".mocks.",
  ".fixture.",
];

// Filenames that are conventionally test bootstrap files — set up
// global polyfills, mock factories, vitest/jest configuration, etc.
// These run only in the test runner, never in the production bundle.
const NON_PRODUCTION_BASENAMES: ReadonlySet<string> = new Set([
  "setuptests.js",
  "setuptests.ts",
  "setuptests.jsx",
  "setuptests.tsx",
  "setupvitest.js",
  "setupvitest.ts",
  "setupvitest.jsx",
  "setupvitest.tsx",
  "setupjest.js",
  "setupjest.ts",
  "vitest.setup.js",
  "vitest.setup.ts",
  "vitest.setup.mjs",
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mts",
  "vitest.config.mjs",
  "jest.setup.js",
  "jest.setup.ts",
  "jest.setup.jsx",
  "jest.setup.tsx",
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "playwright.config.ts",
  "playwright.config.js",
  "cypress.config.ts",
  "cypress.config.js",
  "karma.conf.js",
  "karma.conf.ts",
  // Build / framework config files
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  "webpack.config.ts",
  "webpack.config.js",
  "webpack.config.mjs",
  "rollup.config.ts",
  "rollup.config.js",
  "rollup.config.mjs",
  "esbuild.config.ts",
  "esbuild.config.js",
  "esbuild.config.mjs",
  "tsup.config.ts",
  "tsup.config.js",
  "tsup.config.mjs",
  "rsbuild.config.ts",
  "rsbuild.config.js",
  "rspack.config.ts",
  "rspack.config.js",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "remix.config.js",
  "remix.config.ts",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "postcss.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "biome.config.ts",
  "biome.config.js",
  "drizzle.config.ts",
  "drizzle.config.js",
  "prisma.config.ts",
  "prisma.config.js",
  "knip.config.ts",
  "knip.config.js",
  "knip.config.mjs",
  "lint-staged.config.js",
  "lint-staged.config.mjs",
]);

// "Source root" path segments that mark the boundary BELOW WHICH a
// file is considered production code, regardless of what wraps the
// source root above. This lets test-fixture projects (laid out as
// `tests/fixtures/<project>/src/<file>`) treat `src/<file>` as
// production — even though the OUTER path contains `/tests/` and
// `/fixtures/`. Without this, the path-segment check below would
// erroneously skip every file inside the fixture project.
//
// We use the LAST occurrence of any source-root marker as the cut
// point — captures `monorepo/tests/fixtures/proj/src/app/page.tsx`
// (cut at `/src/`, only check `app/page.tsx`).
const SOURCE_ROOT_SEGMENTS: ReadonlyArray<string> = [
  "/src/",
  "/app/",
  "/lib/",
  "/components/",
  "/pages/",
  "/features/",
  "/modules/",
  "/packages/",
  "/apps/",
  "/frontend/",
  "/client/",
];

// Dot-prefixed directories (`.storybook/`, `.dumi/`) are tool-owned and
// never production code, even when they wrap source-root-looking layouts
// like `.dumi/pages/.../components/...` — so they're checked against the
// FULL path, before the source-root scoping below cuts them off.
const DOT_PREFIXED_NON_PRODUCTION_PATH_SEGMENTS: ReadonlyArray<string> =
  NON_PRODUCTION_PATH_SEGMENTS.filter((segment) => segment.startsWith("/."));

const sliceBelowSourceRoot = (filename: string): string => {
  let cutAt = -1;
  for (const segment of SOURCE_ROOT_SEGMENTS) {
    const lastIdx = filename.lastIndexOf(segment);
    if (lastIdx > cutAt) cutAt = lastIdx;
  }
  if (cutAt < 0) return filename;
  return filename.slice(cutAt);
};

// Every rule consults this with the same filename while a file lints, so a
// one-entry memo absorbs the ~70 substring scans below for all but the first
// call per file.
let lastFilename: string | undefined;
let lastResult = false;

export const isTestlikeFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  if (rawFilename === lastFilename) return lastResult;
  lastFilename = rawFilename;
  lastResult = computeIsTestlikeFilename(rawFilename);
  return lastResult;
};

export const isTestlikeFilenameIgnoringPathSegments = (
  rawFilename: string | undefined,
  ignoredPathSegments: ReadonlySet<string>,
): boolean => (rawFilename ? computeIsTestlikeFilename(rawFilename, ignoredPathSegments) : false);

const computeIsTestlikeFilename = (
  rawFilename: string,
  ignoredPathSegments: ReadonlySet<string> = new Set(),
): boolean => {
  const filename = rawFilename.replaceAll("\\", "/");
  const lastSlash = filename.lastIndexOf("/");
  const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
  if (NON_PRODUCTION_BASENAMES.has(basename.toLowerCase())) return true;
  // The filename suffix check (`.test.`, `.spec.`, `.stories.` etc.)
  // is on the BASENAME only — these are unambiguous regardless of
  // path context.
  for (const suffix of NON_PRODUCTION_FILENAME_SUFFIXES) {
    if (basename.includes(suffix)) return true;
  }
  // HACK: root a relative path so a filename that STARTS with a
  // dot-directory (`.dumi/pages/index.tsx`) still matches the
  // slash-prefixed `/.dumi/` segment.
  const rootedFilename = filename.startsWith("/") ? filename : `/${filename}`;
  for (const dotDirectorySegment of DOT_PREFIXED_NON_PRODUCTION_PATH_SEGMENTS) {
    if (ignoredPathSegments.has(dotDirectorySegment)) continue;
    if (rootedFilename.includes(dotDirectorySegment)) return true;
  }
  // The PATH-segment check scopes itself to "below the source root":
  // for `tests/fixtures/proj/src/app/state-issues.tsx`, it only sees
  // `/src/app/state-issues.tsx` — so the OUTER `/tests/` + `/fixtures/`
  // wrappers don't accidentally testlike-skip the production code
  // INSIDE the fixture project. Critical for any test runner that
  // builds a fake project under a test directory to assert rule
  // behaviour.
  // Dot-directories (`/.storybook/`, `/.dumi/`) are tooling/docs surfaces
  // that can never BE a source root, yet often CONTAIN one (`.dumi/pages/
  // index/components/Group.tsx`) — so they're matched against the full
  // path, before the source-root cut hides them.
  const scopedFilename = sliceBelowSourceRoot(filename);
  for (const segment of NON_PRODUCTION_PATH_SEGMENTS) {
    if (ignoredPathSegments.has(segment)) continue;
    const haystack = segment.startsWith("/.") ? filename : scopedFilename;
    if (haystack.includes(segment)) return true;
  }
  return false;
};
