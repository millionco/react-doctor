import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

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
      deps: { neverBundle: ["oxlint", "oxlint-plugin-react-doctor", "typescript"] },
      dts: true,
      target: "node22",
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
      deps: { neverBundle: ["oxlint", "oxlint-plugin-react-doctor", "typescript"] },
      dts: true,
      target: "node22",
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
