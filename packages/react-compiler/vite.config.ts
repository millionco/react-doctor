import { defineConfig } from "vite-plus";
import { reactCompilerTransform } from "./src/__tests__/runner/e2e-plugin";

const E2E_INCLUDE = ["src/__tests__/e2e/**/*.e2e.{js,tsx}"];
const TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  // Upstream's main jest project runs unit tests with `__DEV__: true`.
  // Only affects src compiled by vite (the unit tests); the fixtures
  // suite loads the production `dist` bundle where `__DEV__` is undefined.
  define: {
    __DEV__: "true",
  },
  test: {
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    // Three projects mirror the upstream jest projects: the `main` unit +
    // snapshot suite (node), and the e2e suite run twice (with/without the
    // compiler) — see scripts/jest/{main,e2e-forget,e2e-classic}.config.js.
    projects: [
      {
        define: { __DEV__: "true" },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/__tests__/**/*.test.ts"],
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
        },
      },
      {
        plugins: [reactCompilerTransform(true)],
        define: { __FORGET__: "true" },
        test: {
          name: "e2e-forget",
          environment: "jsdom",
          globals: true,
          include: E2E_INCLUDE,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
        },
      },
      {
        plugins: [reactCompilerTransform(false)],
        define: { __FORGET__: "false" },
        test: {
          name: "e2e-no-forget",
          environment: "jsdom",
          globals: true,
          include: E2E_INCLUDE,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
        },
      },
    ],
  },
  pack: [
    {
      entry: { index: "./src/index.ts" },
      format: ["cjs"],
      deps: {
        // Match upstream's tsup config: Babel packages are provided by the
        // host toolchain (a Babel plugin runs inside the consumer's Babel),
        // so keep them external and bundle the small pure-JS deps inline.
        neverBundle: [
          "@babel/code-frame",
          "@babel/core",
          "@babel/generator",
          "@babel/parser",
          "@babel/traverse",
          "@babel/types",
        ],
        alwaysBundle: ["invariant", "pretty-format", "zod", "zod-validation-error"],
      },
      dts: false,
      target: "node20",
      platform: "node",
      fixedExtension: false,
    },
  ],
});
