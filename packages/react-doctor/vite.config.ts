import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

const copySkillToDist = () => {
  const skillSource = path.resolve(packageRoot, "../../skills/react-doctor");
  const skillTarget = path.resolve(packageRoot, "dist/skills/react-doctor");
  if (!fs.existsSync(skillSource)) {
    throw new Error(`Skill source missing at ${skillSource}; expected to ship dist/skills/`);
  }
  fs.rmSync(skillTarget, { recursive: true, force: true });
  fs.mkdirSync(skillTarget, { recursive: true });
  fs.cpSync(skillSource, skillTarget, { recursive: true });
};

export default defineConfig({
  pack: [
    {
      entry: { cli: "./src/cli.ts" },
      deps: { neverBundle: ["oxlint", "knip", "knip/session"] },
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
      deps: { neverBundle: ["oxlint", "knip", "knip/session"] },
      dts: true,
      target: "node22",
      platform: "node",
      fixedExtension: false,
    },
    {
      entry: {
        browser: "./src/browser.ts",
        worker: "./src/worker.ts",
      },
      dts: true,
      target: "es2022",
      platform: "browser",
      fixedExtension: false,
    },
    {
      entry: { "react-doctor-plugin": "./src/plugin/index.ts" },
      target: "node22",
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
