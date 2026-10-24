import * as fs from "node:fs";
import * as path from "node:path";
import {
  JSX_BABEL_CONFIG_FILE_NAMES,
  JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
  JSX_TYPESCRIPT_CONFIG_FILE_NAMES,
} from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";

interface UnconfiguredReactJsxEnvironmentInput {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly sourceText: string;
}

export const hasUnconfiguredReactJsxEnvironment = ({
  filename,
  program,
  sourceText,
}: UnconfiguredReactJsxEnvironmentInput): boolean => {
  const manifest = readNearestPackageManifest(filename);
  const declaredReact =
    manifest?.dependencies?.react ??
    manifest?.devDependencies?.react ??
    manifest?.peerDependencies?.react ??
    manifest?.optionalDependencies?.react;
  if (
    !findNearestPackageDirectory(filename) ||
    !manifest ||
    typeof declaredReact !== "string" ||
    !parsePackageVersion(declaredReact.trim().replace(/^[~^]/u, "")) ||
    hasJsxRuntimePragma({ filename, program, sourceText })
  )
    return false;
  let directory = path.dirname(filename);
  while (true) {
    if (
      [
        ...JSX_BABEL_CONFIG_FILE_NAMES,
        ...JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
        ...JSX_TYPESCRIPT_CONFIG_FILE_NAMES,
      ].some((basename) => {
        const configPath = path.join(directory, basename);
        recordExistenceProbe(configPath);
        return fs.existsSync(configPath);
      })
    )
      return false;
    const ancestorManifest = readPackageManifest(directory);
    if (ancestorManifest && Object.hasOwn(ancestorManifest, "babel")) return false;
    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) return true;
    directory = parentDirectory;
  }
};
