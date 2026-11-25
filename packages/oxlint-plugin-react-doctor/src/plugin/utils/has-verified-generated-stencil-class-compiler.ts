import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { readGeneratedStencil2Configuration } from "./read-generated-stencil2-configuration.js";
import { readPhysicalImplicitJsxProgram } from "./read-physical-implicit-jsx-program.js";
import { hasStockGeneratedStencilGeneratorLaunch } from "./has-stock-generated-stencil-generator-launch.js";
import { readStockStencilBuildTools } from "./read-stock-stencil-build-tools.js";
import type { RuleContext } from "./rule-context.js";

const exists = (filename: string): boolean => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false }) !== undefined;
};

const findPnpmWorkspace = (projectRoot: string): string | null => {
  for (let directory = projectRoot; ; directory = path.dirname(directory)) {
    const workspaceManifest = path.join(directory, "pnpm-workspace.yaml");
    if (exists(path.join(directory, "node_modules", ".pnpm"))) {
      return directory === projectRoot || exists(workspaceManifest) ? directory : null;
    }
    if (exists(workspaceManifest) || directory === path.dirname(directory)) return null;
  }
};

export const hasVerifiedGeneratedStencilClassCompiler = (
  context: RuleContext,
  projectRoot: string,
  filename: string,
): boolean => {
  if (!readPhysicalImplicitJsxProgram(context, filename)) return false;
  const workspaceRoot = findPnpmWorkspace(projectRoot);
  if (!workspaceRoot) return false;
  const configuration = readGeneratedStencil2Configuration(workspaceRoot, filename);
  if (!configuration) return false;
  const { projectDirectory, createsLibraryDirectory } = configuration.owner;
  return (
    hasStockGeneratedStencilGeneratorLaunch(workspaceRoot, projectDirectory) &&
    Boolean(
      readStockStencilBuildTools({ workspaceRoot, projectDirectory, createsLibraryDirectory }),
    )
  );
};
