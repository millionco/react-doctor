import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
];
const VITE_MODULE_SOURCE_EXTENSIONS = [
  ".mjs",
  ".js",
  ".mts",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".cjs",
  ".cts",
];
const STOCK_REACT_VERSION_PATTERN = /^[~^]?18\.\d+\.\d+$/;
const STOCK_VITE_VERSION_PATTERN = /^[~^]?4\.\d+\.\d+$/;
const VITE_LIFECYCLE_SCRIPT_NAMES = [
  "prepare",
  "preinstall",
  "install",
  "postinstall",
  "prebuild",
  "postbuild",
  "predev",
  "postdev",
  "prepreview",
  "postpreview",
];
const pathExists = (candidate: string): boolean => {
  recordExistenceProbe(candidate);
  return fs.existsSync(candidate);
};

const isStockReactViteConfiguration = (filename: string): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.body.length !== 3) return false;
  const [first, second, exported] = program.body;
  if (
    !isNodeOfType(first, "ImportDeclaration") ||
    !isNodeOfType(second, "ImportDeclaration") ||
    first.importKind === "type" ||
    first.specifiers.length !== 1 ||
    second.importKind === "type" ||
    second.specifiers.length !== 1 ||
    !isNodeOfType(exported, "ExportDefaultDeclaration")
  ) {
    return false;
  }
  const imports = [first, second];
  const [defineConfig] = imports.find((entry) => entry.source.value === "vite")?.specifiers ?? [];
  const [react] =
    imports.find((entry) => entry.source.value === "@vitejs/plugin-react")?.specifiers ?? [];
  const call = stripParenExpression(exported.declaration);
  if (
    !isNodeOfType(defineConfig, "ImportSpecifier") ||
    !isNodeOfType(defineConfig.imported, "Identifier") ||
    defineConfig.imported.name !== "defineConfig" ||
    defineConfig.importKind === "type" ||
    !isNodeOfType(react, "ImportDefaultSpecifier") ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.callee.name !== defineConfig.local.name ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.arguments[0], "ObjectExpression")
  ) {
    return false;
  }
  return call.arguments[0].properties.every((entry) => {
    if (!isNodeOfType(entry, "Property") || entry.computed || entry.kind !== "init") return false;
    const value = stripParenExpression(entry.value);
    switch (getStaticPropertyKeyName(entry)) {
      case "plugins": {
        if (!isNodeOfType(value, "ArrayExpression") || value.elements.length !== 1) return false;
        const plugin = value.elements[0];
        return (
          isNodeOfType(plugin, "CallExpression") &&
          !plugin.optional &&
          plugin.arguments.length === 0 &&
          isNodeOfType(plugin.callee, "Identifier") &&
          plugin.callee.name === react.local.name
        );
      }
      case "build":
        return (
          isNodeOfType(value, "ObjectExpression") &&
          value.properties.every(
            (option) =>
              isNodeOfType(option, "Property") &&
              !option.computed &&
              option.kind === "init" &&
              getStaticPropertyKeyName(option) === "chunkSizeWarningLimit" &&
              isNodeOfType(option.value, "Literal") &&
              typeof option.value.value === "number",
          )
        );
      default:
        return false;
    }
  });
};

export const hasStaticViteModuleResolution = (filename: string): boolean => {
  const packageDirectory = findNearestPackageDirectory(path.resolve(filename));
  if (!packageDirectory) return false;
  const manifest = readPackageManifest(packageDirectory);
  if (
    !manifest ||
    manifest.scripts?.build !== "vite build" ||
    (manifest.scripts.dev !== undefined && manifest.scripts.dev !== "vite") ||
    (manifest.scripts.preview !== undefined && manifest.scripts.preview !== "vite preview")
  )
    return false;
  if (["resolutions", "overrides", "pnpm", "browser"].some((key) => Reflect.has(manifest, key)))
    return false;
  if (VITE_LIFECYCLE_SCRIPT_NAMES.some((script) => Reflect.has(manifest.scripts ?? {}, script)))
    return false;
  const react = manifest.dependencies?.react;
  const vite = manifest.devDependencies?.vite;
  const reactPlugin = manifest.devDependencies?.["@vitejs/plugin-react"];
  if (
    typeof react !== "string" ||
    !STOCK_REACT_VERSION_PATTERN.test(react) ||
    ![vite, reactPlugin].every(
      (specifier) => typeof specifier === "string" && STOCK_VITE_VERSION_PATTERN.test(specifier),
    )
  ) {
    return false;
  }
  const configFiles = VITE_CONFIG_FILENAMES.map((config) =>
    path.join(packageDirectory, config),
  ).filter(pathExists);
  return configFiles.length === 1 && isStockReactViteConfiguration(configFiles[0]);
};

export const resolveUniqueViteRelativeModule = (
  filename: string,
  source: string,
): string | null => {
  const referencePath = path.resolve(path.dirname(filename), source);
  const extension = path.extname(referencePath);
  if (extension && !VITE_MODULE_SOURCE_EXTENSIONS.includes(extension)) return null;
  const stem = extension ? referencePath.slice(0, -extension.length) : referencePath;
  const candidates = [stem, ...VITE_MODULE_SOURCE_EXTENSIONS.map((suffix) => stem + suffix)].filter(
    pathExists,
  );
  if (candidates.length !== 1) return null;
  const [resolvedPath] = candidates;
  try {
    return fs.lstatSync(resolvedPath).isFile() && fs.realpathSync(resolvedPath) === resolvedPath
      ? resolvedPath
      : null;
  } catch {
    return null;
  }
};
