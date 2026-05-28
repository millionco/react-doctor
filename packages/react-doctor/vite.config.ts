import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

const TEST_TIMEOUT_MS = 30_000;
const WINDOWS_TEST_MAX_WORKERS = 1;

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

const copySkillToDist = () => {
  const skillSource = path.resolve(packageRoot, "../../skills/react-doctor");
  const skillTarget = path.resolve(packageRoot, "dist/skills/react-doctor");
  if (!fs.existsSync(skillSource)) {
    throw new Error(`Skill source missing at ${skillSource}; expected to ship dist/skills/`);
  }
  assertSkillManifestParseable(path.join(skillSource, "SKILL.md"));
  fs.rmSync(skillTarget, { recursive: true, force: true });
  fs.mkdirSync(skillTarget, { recursive: true });
  fs.cpSync(skillSource, skillTarget, { recursive: true });
};

export default defineConfig({
  pack: [
    {
      entry: { cli: "./src/cli/index.ts" },
      deps: {
        // Inline pure-JS CLI deps so `npm i react-doctor` skips
        // ~15 transitive installs (commander, ora, and ora's spinner
        // / cursor / log-symbols / string-width chain). Native
        // (oxlint), the lint plugin, prompts (we monkey-patch it via
        // require so the runtime copy must be on disk), agent-install
        // (its jsonc-parser/yaml/toml transitives ship as UMD that
        // doesn't bundle cleanly), and the typescript compiler all
        // stay external.
        alwaysBundle: ["commander", "ora"],
        neverBundle: [
          "@effect/platform-node-shared",
          "agent-install",
          // HACK: deslop-js wraps oxc-parser / oxc-resolver, both of
          // which load platform-specific NAPI bindings via require().
          // Rollup happily inlines the JS loader chain but rewrites
          // the native lookups to fingerprinted `./assets/*.node`
          // paths that never make it into the published tarball (and
          // also strips the standard `@oxc-{parser,resolver}/binding-
          // <platform>` fallback). Keep deslop-js (and its native
          // siblings) external so the loaders run untouched and Node
          // resolves the bindings from the deslop-js node_modules
          // tree on install — see issue #404.
          "deslop-js",
          // Effect ships as ~1MB+ of tree-shakable TypeScript; bundling
          // it would balloon the published tarball. Match react-doctor-evals
          // and let installers pull it as a regular dependency.
          "effect",
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
          copySkillToDist();
        },
      },
    },
    {
      entry: { index: "./src/index.ts" },
      deps: {
        alwaysBundle: ["commander", "ora"],
        neverBundle: [
          "@effect/platform-node-shared",
          "agent-install",
          "deslop-js",
          "effect",
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
  ],
  test: {
    testTimeout: TEST_TIMEOUT_MS,
    ...(process.platform === "win32"
      ? {
          fileParallelism: false,
          maxWorkers: WINDOWS_TEST_MAX_WORKERS,
          poolOptions: { forks: { singleFork: true } },
        }
      : {}),
  },
});
