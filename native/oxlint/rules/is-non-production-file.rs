const NON_PRODUCTION_PATH_SEGMENTS: &[&str] = &[
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
    "/test-stubs/",
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

const NON_PRODUCTION_FILENAME_SUFFIXES: &[&str] = &[
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

const NON_PRODUCTION_BASENAMES: &[&str] = &[
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
];

const SOURCE_ROOT_SEGMENTS: &[&str] = &[
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

fn is_non_production_file(ctx: &crate::context::ContextHost) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    is_non_production_filename(&filename)
}

fn is_non_production_filename(filename: &str) -> bool {
    let basename = filename.rsplit('/').next().unwrap_or(filename);
    let lowercase_basename = basename.to_lowercase();
    if NON_PRODUCTION_BASENAMES.contains(&lowercase_basename.as_str())
        || NON_PRODUCTION_FILENAME_SUFFIXES
            .iter()
            .any(|suffix| basename.contains(suffix))
    {
        return true;
    }
    if ["/.storybook/", "/.dumi/"]
        .iter()
        .any(|segment| filename.contains(segment))
    {
        return true;
    }
    let scoped_filename = SOURCE_ROOT_SEGMENTS
        .iter()
        .filter_map(|segment| filename.rfind(segment))
        .max()
        .map_or(filename, |source_root_index| &filename[source_root_index..]);
    NON_PRODUCTION_PATH_SEGMENTS.iter().any(|segment| {
        let haystack = if segment.starts_with("/.") {
            filename
        } else {
            scoped_filename
        };
        haystack.contains(segment)
    })
}
