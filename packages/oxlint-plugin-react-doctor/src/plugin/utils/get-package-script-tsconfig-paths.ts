import * as fs from "node:fs";
import * as path from "node:path";
import { isPathInside } from "./is-path-inside.js";
import { readPackageManifest } from "./read-nearest-package-manifest.js";

const TSC_COMMAND_PATTERN = /(?:^|[\s;&|/])tsc(?=\s|$)/u;
const EXPLICIT_TSC_CONFIG_PATTERN = /(?:^|\s)(?:-p|--project)(?=\s|$)/u;
const TSC_BUILD_MODE_PATTERN = /(?:^|\s)(?:-b|--build)(?=\s|$)/u;
const JSX_CLI_OVERRIDE_PATTERN = /(?:^|\s)--jsx(?:Factory|ImportSource)?(?=\s|$)/iu;
const LITERAL_TSC_COMMAND_PATTERN =
  /^\s*(?:(?:(?:pnpm|yarn|bun)(?:\s+exec)?|npm\s+exec(?:\s+--)?|npx|bunx)\s+)?(?:[\w./-]+\/)?tsc\s+([^;&|$`\r\n<>]+)\s*$/u;
const PROJECT_PATH_ARGUMENT_PATTERN =
  /(?:^|\s)(?:-p|--project)\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))(?=\s|$)/gu;

export const getPackageScriptTsconfigPaths = (packageDirectory: string): string[] | null => {
  const manifest = readPackageManifest(packageDirectory);
  if (!manifest) return null;
  const configPaths: string[] = [];
  for (const script of Object.values(manifest.scripts ?? {})) {
    if (typeof script !== "string" || !TSC_COMMAND_PATTERN.test(script)) continue;
    if (JSX_CLI_OVERRIDE_PATTERN.test(script) || TSC_BUILD_MODE_PATTERN.test(script)) {
      return null;
    }
    if (!EXPLICIT_TSC_CONFIG_PATTERN.test(script)) continue;

    const argumentsText = LITERAL_TSC_COMMAND_PATTERN.exec(script)?.[1];
    if (!argumentsText) return null;
    const projectArguments = [...argumentsText.matchAll(PROJECT_PATH_ARGUMENT_PATTERN)];
    if (projectArguments.length !== 1) return null;
    const projectArgument = projectArguments[0];
    const projectPath = projectArgument?.[1] ?? projectArgument?.[2] ?? projectArgument?.[3];
    if (!projectPath || projectPath.startsWith("-") || /[~*?{}\\]/u.test(projectPath)) return null;
    const absolutePath = path.resolve(packageDirectory, projectPath);
    if (path.isAbsolute(projectPath) || !isPathInside(absolutePath, packageDirectory)) return null;
    const entry = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (entry?.isFile()) {
      configPaths.push(absolutePath);
    } else if (entry?.isDirectory()) {
      configPaths.push(path.join(absolutePath, "tsconfig.json"));
    } else {
      return null;
    }
  }
  return configPaths;
};
