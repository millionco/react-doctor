import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "tsdown";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
  version: string;
};

const copySkillToDist = () => {
  const packageRoot = process.cwd();
  const skillSource = path.resolve(packageRoot, "../../skills/react-doctor");
  const skillTarget = path.resolve(packageRoot, "dist/skills/react-doctor");
  if (!fs.existsSync(skillSource)) return;
  fs.rmSync(skillTarget, { recursive: true, force: true });
  fs.mkdirSync(skillTarget, { recursive: true });
  fs.cpSync(skillSource, skillTarget, { recursive: true });
};

export default defineConfig([
  {
    entry: {
      cli: "./src/cli.ts",
    },
    external: ["oxlint", "knip", "knip/session", "react-doctor-core"],
    dts: true,
    target: "node18",
    platform: "node",
    env: {
      VERSION: process.env.VERSION ?? packageJson.version,
    },
    fixedExtension: false,
    banner: "#!/usr/bin/env node",
    hooks: {
      "build:done": () => {
        copySkillToDist();
      },
    },
  },
  {
    entry: {
      index: "./src/index.ts",
    },
    external: ["oxlint", "knip", "knip/session", "react-doctor-core"],
    dts: true,
    target: "node18",
    platform: "node",
    fixedExtension: false,
  },
  {
    entry: {
      "react-doctor-plugin": "../react-doctor-core/src/plugin/index.ts",
    },
    target: "node18",
    platform: "node",
    fixedExtension: false,
  },
]);
