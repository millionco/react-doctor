import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import launchMembers from "./stock-typescript59-launch-members.json" with { type: "json" };
import { readDeclaredViteSelection } from "./read-vite-project-selection.js";
import {
  readBoundedViteEnvCallback,
  type BoundedViteEnvCallbackProjection,
} from "./read-bounded-vite-env-callback.js";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";

export interface StandaloneVite7TscSelection {
  readonly selection: NonNullable<ReturnType<typeof readDeclaredViteSelection>["selection"]>;
  readonly callback: BoundedViteEnvCallbackProjection;
  readonly typeScriptFirstPhase: "stock-5.9.3-noemit-incremental-buildinfo-only" | null;
  readonly viteCompilerProfileStillRequired: true;
  readonly sceneAndRendererQualificationStillRequired: true;
}
const read = (file: string): string | null => {
  recordExistenceProbe(file);
  recordRealpathProbe(file);
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile() || fs.realpathSync(file) !== file)
    return null;
  recordContentProbe(file);
  return fs.readFileSync(file, "utf8");
};
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
const hasStockNoEmitConfig = (root: string): boolean => {
  const raw = read(path.join(root, "tsconfig.json"));
  if (!raw) return false;
  const config = JSON.parse(raw);
  if (Object.keys(config).some((key) => !["compilerOptions", "include", "exclude"].includes(key)))
    return false;
  const options = config.compilerOptions;
  if (!options || typeof options !== "object" || Array.isArray(options)) return false;
  const allowed = new Set([
    "target",
    "lib",
    "allowJs",
    "rootDir",
    "skipLibCheck",
    "esModuleInterop",
    "allowSyntheticDefaultImports",
    "strict",
    "forceConsistentCasingInFileNames",
    "module",
    "moduleResolution",
    "isolatedModules",
    "resolveJsonModule",
    "noEmit",
    "jsx",
    "sourceMap",
    "declaration",
    "noUnusedLocals",
    "noUnusedParameters",
    "incremental",
    "noFallthroughCasesInSwitch",
    "types",
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) return false;
  if (
    options.noEmit !== true ||
    options.incremental !== true ||
    options.declaration !== false ||
    options.sourceMap !== false ||
    options.jsx !== "react-jsx" ||
    options.module !== "ESNext" ||
    options.moduleResolution !== "Bundler" ||
    options.target !== "ESNext" ||
    options.rootDir !== "./"
  )
    return false;
  for (const [name, value] of Object.entries(options)) {
    if (["lib", "types"].includes(name)) {
      if (!isStringArray(value)) return false;
    } else if (
      !["target", "module", "moduleResolution", "jsx", "rootDir"].includes(name) &&
      typeof value !== "boolean"
    )
      return false;
  }
  return (
    isStringArray(config.include) &&
    JSON.stringify(config.include) === JSON.stringify(["**/*.ts", "**/*.tsx", "vite.config.ts"]) &&
    isStringArray(config.exclude) &&
    JSON.stringify(config.exclude) === JSON.stringify(["node_modules", "build"]) &&
    JSON.stringify(options.types) === JSON.stringify(["vite/client", "vite-plugin-svgr/client"])
  );
};
const hasStockTypeScriptLauncher = (root: string): boolean => {
  const packageRoot = path.join(root, "node_modules", "typescript");
  recordExistenceProbe(packageRoot);
  recordRealpathProbe(packageRoot);
  if (
    !fs.lstatSync(packageRoot, { throwIfNoEntry: false })?.isDirectory() ||
    fs.realpathSync(packageRoot) !== packageRoot
  )
    return false;
  const launcher = path.join(root, "node_modules", ".bin", "tsc");
  recordExistenceProbe(launcher);
  recordRealpathProbe(launcher);
  if (!hasExpectedNpmLauncher(launcher, "../typescript/bin/tsc")) return false;
  for (const [member, expected] of Object.entries(launchMembers)) {
    const content = read(path.join(packageRoot, member));
    if (content === null || createHash("sha256").update(content).digest("hex") !== expected)
      return false;
  }
  return true;
};
export const readStandaloneVite7TscSelection = (
  filename: string,
): StandaloneVite7TscSelection | null => {
  try {
    if (process.env.ANALYZE === "true") return null;
    const { selection } = readDeclaredViteSelection(filename, {
      allowTypeScriptNoEmitPrefix: true,
    });
    if (!selection || !hasStockNodeNpmCompilerEnvironment(selection.projectDirectory)) return null;
    const raw = read(selection.manifestFile);
    if (!raw) return null;
    const build: unknown = JSON.parse(raw).scripts?.build;
    if (typeof build !== "string") return null;
    const usesTypeScript = /^[ \t]*tsc[ \t]*&&/u.test(build);
    const viteLauncher = path.join(selection.projectDirectory, "node_modules", ".bin", "vite");
    recordExistenceProbe(viteLauncher);
    recordRealpathProbe(viteLauncher);
    if (!hasExpectedNpmLauncher(viteLauncher, "../vite/bin/vite.js")) return null;
    if (
      usesTypeScript &&
      (!hasStockNoEmitConfig(selection.projectDirectory) ||
        !hasStockTypeScriptLauncher(selection.projectDirectory))
    )
      return null;
    const program = parseSourceFile(selection.configFile);
    const callback = program ? readBoundedViteEnvCallback(program) : null;
    if (!callback) return null;
    return {
      selection,
      callback,
      typeScriptFirstPhase: usesTypeScript ? "stock-5.9.3-noemit-incremental-buildinfo-only" : null,
      viteCompilerProfileStillRequired: true,
      sceneAndRendererQualificationStillRequired: true,
    };
  } catch {
    return null;
  }
};
