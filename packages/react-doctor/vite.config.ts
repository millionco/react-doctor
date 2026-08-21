import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

const TEST_TIMEOUT_MS = 30_000;

// HACK: agent-install's parseSkillManifest silently returns `null` when
// frontmatter is missing or invalid `name:` / `description:` fields,
// which caused `react-doctor install` to print success while writing
// zero files (see review-report.md H1). Validate at build time so a
// broken SKILL.md is caught here, not at install time.
const assertSkillManifestParseable = (manifestPath: string): void => {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error(`SKILL.md at ${manifestPath} is missing YAML frontmatter (--- ... ---).`);
  }
  const frontmatter = match[1] ?? "";
  const hasName = /^[ \t]*name[ \t]*:[ \t]*\S/m.test(frontmatter);
  const hasDescription = /^[ \t]*description[ \t]*:[ \t]*\S/m.test(frontmatter);
  if (!hasName || !hasDescription) {
    throw new Error(
      `SKILL.md at ${manifestPath} must declare both "name:" and "description:" in frontmatter (got name=${hasName}, description=${hasDescription}).`,
    );
  }
};

// Ship every skill directory under `skills/` (the `react-doctor` skill and
// its `references/` today) so `react-doctor install` can install them all.
// Each is validated at build time so a broken SKILL.md is caught here, not
// at install time.
const copySkillsToDist = () => {
  const skillsRoot = path.resolve(packageRoot, "../../skills");
  const distSkillsRoot = path.resolve(packageRoot, "dist/skills");
  const primarySkillSource = path.join(skillsRoot, "react-doctor");
  if (!fs.existsSync(primarySkillSource)) {
    throw new Error(`Skill source missing at ${primarySkillSource}; expected to ship dist/skills/`);
  }
  fs.rmSync(distSkillsRoot, { recursive: true, force: true });
  const skillNames = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")));
  for (const skillName of skillNames) {
    const skillSource = path.join(skillsRoot, skillName);
    const skillTarget = path.join(distSkillsRoot, skillName);
    assertSkillManifestParseable(path.join(skillSource, "SKILL.md"));
    fs.mkdirSync(skillTarget, { recursive: true });
    fs.cpSync(skillSource, skillTarget, { recursive: true });
  }
};

export default defineConfig({
  pack: [
    {
      entry: {
        cli: "./src/cli/index.ts",
        "project-analysis-worker": "./src/project-analysis-worker.ts",
      },
      deps: {
        // Inline pure-JS CLI deps and the Ink/React renderer so the inspected
        // project cannot supply a missing or incompatible React peer. Native
        // dependencies, Yoga's WASM module, prompts (we monkey-patch it via
        // require), agent-install (its config parsers ship as UMD), and the
        // TypeScript compiler stay external.
        // `yaml` (pure JS, no native deps) backs the `ci config` in-place
        // workflow editor; inline it so end users get no extra install.
        alwaysBundle: [
          "commander",
          "ink",
          "ink-spinner",
          "ora",
          "react",
          "react-devtools-core",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react-reconciler",
          "scheduler",
          "yaml",
        ],
        neverBundle: [
          "@astrojs/compiler",
          // Sentry bundles its own OpenTelemetry instrumentation chain
          // and resolves native/optional deps via require() at runtime;
          // keep it external so those lookups run untouched.
          "@sentry/node",
          "agent-install",
          // Config loading/editing: jiti (TS/JS config eval) + confbox
          // (JSONC parse) power the loader in @react-doctor/core (bundled
          // in here), and magicast edits .ts/.js configs for `rules`.
          // All pure-JS but heavy / runtime-resolving, so keep external
          // and installed rather than inlined into the CLI bundle.
          "confbox",
          "jiti",
          "magicast",
          // HACK: oxc-parser / oxc-resolver load platform-specific NAPI bindings via require().
          // Rollup happily inlines the JS loader chain but rewrites
          // the native lookups to fingerprinted `./assets/*.node`
          // paths that never make it into the published tarball (and
          // also strips the standard `@oxc-{parser,resolver}/binding-
          // <platform>` fallback). Keep the native packages external so
          // the loaders run untouched and Node resolves their bindings
          // from node_modules on install — see issue #404.
          "oxc-parser",
          "oxc-resolver",
          "oxlint",
          "oxlint-plugin-react-doctor",
          "playwright-core",
          "prompts",
          "typescript",
          "yoga-layout",
        ],
      },
      dts: true,
      target: "node20",
      platform: "node",
      // Emit source maps so the release pipeline (scripts/sentry-sourcemaps.mjs)
      // can inject Sentry Debug IDs and upload them for readable, de-minified
      // stack traces. The `.map` files are NOT shipped in the npm tarball (see
      // package.json "files"); symbolication happens server-side in Sentry via
      // the Debug IDs injected into the published `dist/cli.js`.
      sourcemap: true,
      env: {
        VERSION: process.env.VERSION ?? packageJson.version,
      },
      // HACK: no shebang on dist/cli.js — the published `bin` entry is
      // bin/react-doctor.js, which owns the `#!/usr/bin/env node` line
      // (and the V8 compile-cache warm-up). dist/cli.js is loaded via
      // `await import(...)` from that shim, where a stray shebang on
      // line 1 isn't useful and just bloats the bundle. (Programmatic
      // `import "react-doctor"` consumers don't care either way — Node
      // ignores a shebang in ESM imports — but we don't need it there.)
      fixedExtension: false,
      hooks: {
        "build:done": () => {
          copySkillsToDist();
        },
      },
    },
    {
      entry: { index: "./src/index.ts" },
      deps: {
        alwaysBundle: ["commander", "ora", "yaml"],
        neverBundle: [
          "@astrojs/compiler",
          "@sentry/node",
          "agent-install",
          "confbox",
          "jiti",
          "magicast",
          "oxc-parser",
          "oxc-resolver",
          "oxlint",
          "oxlint-plugin-react-doctor",
          "prompts",
          "typescript",
        ],
      },
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
    },
    {
      entry: { "runtime-scan/browser-probe": "./src/cli/runtime-scan/browser-probe.ts" },
      deps: {
        alwaysBundle: ["bippy", "react"],
      },
      clean: false,
      dts: false,
      format: ["iife"],
      target: "es2022",
      platform: "browser",
      outDir: "./dist",
    },
  ],
  test: {
    testTimeout: TEST_TIMEOUT_MS,
  },
});
