import * as fs from "node:fs";
import * as path from "node:path";
import { TSCONFIG_EXTENDS_MAX_DEPTH } from "../constants/thresholds.js";
import { STANDARD_REACT_JSX_MODES } from "../constants/react.js";
import {
  NATIVE_LABEL_CANONICAL_MODULE_SOURCES,
  NATIVE_LABEL_BABEL_CONFIG_NAMES,
  NATIVE_LABEL_EXPO_TSCONFIG_SOURCE,
  NATIVE_LABEL_TSCONFIG_FILE_NAMES,
} from "../constants/react-native.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { normalizeFilename } from "./normalize-filename.js";
import { readNearestPackageManifest } from "./read-nearest-package-manifest.js";
import { resolveModulePath } from "./resolve-module-path.js";
import {
  isTsconfigObjectRecord,
  parseTsconfigFile,
  resolveTsconfigExtendsPath,
} from "./resolve-tsconfig-alias.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";

export const hasNativeLabelJsxConfiguration = (
  filename: string,
  rootDirectory: string,
): boolean => {
  const manifest = readNearestPackageManifest(filename);
  const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies };
  if (manifest && Object.hasOwn(manifest, "babel")) return false;
  if (typeof dependencies.react !== "string" || typeof dependencies["react-native"] !== "string")
    return false;
  if (
    [...NATIVE_LABEL_CANONICAL_MODULE_SOURCES].some(
      (source) =>
        resolveWebpackAliasPath(filename, source)?.declared || resolveModulePath(filename, source),
    )
  )
    return false;
  const visited = new Set<string>();
  const inspectConfiguration = (configPath: string, isDeclaredExpoBase = false): boolean => {
    if (visited.size > TSCONFIG_EXTENDS_MAX_DEPTH || visited.has(configPath)) return false;
    visited.add(configPath);
    recordExistenceProbe(configPath);
    try {
      if (
        !fs.statSync(configPath).isFile() ||
        (!isDeclaredExpoBase && fs.realpathSync(configPath) !== configPath)
      )
        return false;
    } catch {
      return false;
    }
    const parsed = parseTsconfigFile(configPath, [], true);
    if (!parsed || Array.isArray(parsed)) return false;
    const options = parsed.compilerOptions ?? {};
    if (!isTsconfigObjectRecord(options) || Array.isArray(options)) return false;
    if (
      Object.hasOwn(options, "jsxFactory") ||
      Object.hasOwn(options, "jsxFragmentFactory") ||
      (Object.hasOwn(options, "jsxImportSource") && options.jsxImportSource !== "react") ||
      (Object.hasOwn(options, "jsx") &&
        (typeof options.jsx !== "string" ||
          (!STANDARD_REACT_JSX_MODES.has(options.jsx) && options.jsx !== "react-native")))
    )
      return false;
    if (Object.hasOwn(options, "baseUrl") || Object.hasOwn(options, "paths")) {
      const paths = options.paths;
      if (
        normalizeFilename(path.dirname(configPath)) !== rootDirectory ||
        options.baseUrl !== "." ||
        !isTsconfigObjectRecord(paths) ||
        Array.isArray(paths)
      )
        return false;
      const [mappingName, ...otherNames] = Object.keys(paths);
      const mapping = paths["@/*"];
      if (mappingName !== "@/*" || otherNames.length || !Array.isArray(mapping)) return false;
      const [target, ...otherTargets] = mapping;
      if (
        typeof target !== "string" ||
        otherTargets.length ||
        normalizeFilename(path.resolve(rootDirectory, target)) !== `${rootDirectory}/src/*`
      )
        return false;
    }
    if (!Object.hasOwn(parsed, "extends")) return true;
    if (
      typeof parsed.extends !== "string" ||
      !parsed.extends ||
      path.isAbsolute(parsed.extends) ||
      path.win32.isAbsolute(parsed.extends)
    )
      return false;
    const parentPath = resolveTsconfigExtendsPath(parsed.extends, path.dirname(configPath));
    if (!parentPath) return false;
    const absoluteParentPath = path.resolve(parentPath);
    recordExistenceProbe(absoluteParentPath);
    const isExpoBase = parsed.extends === NATIVE_LABEL_EXPO_TSCONFIG_SOURCE;
    if (isExpoBase && typeof dependencies.expo !== "string") return false;
    if (fs.existsSync(absoluteParentPath))
      return inspectConfiguration(absoluteParentPath, isExpoBase);
    return (
      isExpoBase &&
      normalizeFilename(path.dirname(configPath)) === rootDirectory &&
      typeof dependencies.expo === "string"
    );
  };
  let directory = path.dirname(filename);
  let selectedConfig: string | null = null;
  while (directory === rootDirectory || directory.startsWith(`${rootDirectory}/`)) {
    if (
      NATIVE_LABEL_BABEL_CONFIG_NAMES.some((basename) => {
        const configPath = path.join(directory, basename);
        recordExistenceProbe(configPath);
        return fs.existsSync(configPath);
      })
    )
      return false;
    for (const basename of NATIVE_LABEL_TSCONFIG_FILE_NAMES) {
      const configPath = path.join(directory, basename);
      recordExistenceProbe(configPath);
      if (selectedConfig === null && fs.existsSync(configPath))
        selectedConfig = path.resolve(configPath);
    }
    if (directory === rootDirectory) break;
    directory = path.dirname(directory);
  }
  return selectedConfig === null || inspectConfiguration(selectedConfig);
};
