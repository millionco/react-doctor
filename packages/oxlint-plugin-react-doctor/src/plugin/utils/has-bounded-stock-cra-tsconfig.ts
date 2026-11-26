import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { parseTsconfigJson } from "./resolve-tsconfig-alias.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const BOOLEAN_OPTIONS = new Set([
  "allowJs",
  "allowSyntheticDefaultImports",
  "declaration",
  "esModuleInterop",
  "forceConsistentCasingInFileNames",
  "isolatedModules",
  "noEmit",
  "noFallthroughCasesInSwitch",
  "resolveJsonModule",
  "skipLibCheck",
  "strict",
]);
const SCALAR_OPTIONS = new Set(["jsx", "target", "module", "moduleResolution"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readTsOptions = (filename: string): Record<string, unknown> | null => {
  const bytes = readProviderMember(filename);
  if (!bytes || bytes.length > 64 * 1024) return null;
  const config = parseTsconfigJson(bytes.toString("utf8"));
  if (!config || !isPlainObject(config.compilerOptions)) return null;
  if (
    Object.keys(config).some((name) => !["extends", "include", "compilerOptions"].includes(name))
  ) {
    return null;
  }
  if (
    Object.hasOwn(config, "include") &&
    (!Array.isArray(config.include) ||
      config.include.some((item) => item !== "src" && item !== ".kktrc.ts"))
  ) {
    return null;
  }
  const ownDirectory = path.dirname(filename);
  for (const [name, value] of Object.entries(config.compilerOptions)) {
    if (BOOLEAN_OPTIONS.has(name) && typeof value === "boolean") continue;
    if (SCALAR_OPTIONS.has(name) && typeof value === "string" && /^[a-z0-9-]+$/iu.test(value))
      continue;
    if (
      name === "lib" &&
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string" && /^[a-z0-9.]+$/iu.test(entry))
    )
      continue;
    if (
      name === "outDir" &&
      typeof value === "string" &&
      value &&
      !path.isAbsolute(value) &&
      isPathInside(path.resolve(ownDirectory, value), ownDirectory)
    )
      continue;
    return null;
  }
  return config;
};

export const hasBoundedStockCraTsconfig = (
  buildRoot: string,
  installationRoot: string,
): boolean => {
  try {
    if (
      !path.isAbsolute(buildRoot) ||
      !path.isAbsolute(installationRoot) ||
      !isPathInside(buildRoot, installationRoot)
    )
      return false;
    const child = readTsOptions(path.join(buildRoot, "tsconfig.json"));
    if (!child || !isPlainObject(child.compilerOptions) || child.compilerOptions.noEmit !== true)
      return false;
    if (!Object.hasOwn(child, "extends")) return true;
    if (
      path.dirname(buildRoot) !== installationRoot ||
      (child.extends !== "../tsconfig" && child.extends !== "../tsconfig.json")
    ) {
      return false;
    }
    const withoutExtension = path.join(installationRoot, "tsconfig");
    recordExistenceProbe(withoutExtension);
    if (fs.lstatSync(withoutExtension, { throwIfNoEntry: false })) return false;
    const parent = readTsOptions(path.join(installationRoot, "tsconfig.json"));
    return Boolean(parent && !Object.hasOwn(parent, "extends"));
  } catch {
    return false;
  }
};
