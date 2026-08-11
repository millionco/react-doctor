import type { DiffInfo, GitBaselineDiffPlan } from "@react-doctor/core";
import { projectManifestChanged } from "./project-manifest-changed.js";
import { resolveProjectDiffIncludePaths } from "./resolve-project-diff-include-paths.js";
import { resolveProjectSourceFilePaths } from "./resolve-project-source-file-paths.js";

interface BuildProjectScanPlanInput {
  readonly rootDirectory: string;
  readonly projectDirectory: string;
  readonly baselineDiffPlan: GitBaselineDiffPlan | null;
  readonly diffInfo: DiffInfo | null;
  readonly isDiffMode: boolean;
  readonly supplyChainEnabled: boolean;
}

export interface ProjectScanPlan {
  readonly includePaths: string[] | undefined;
  readonly projectBaselineBaseFiles: string[] | null;
  readonly projectBaselineHeadFiles: string[] | null;
  readonly shouldSkipProject: boolean;
  readonly supplyChainManifestChanged: boolean;
}

export const buildProjectScanPlan = (input: BuildProjectScanPlanInput): ProjectScanPlan => {
  const projectBaselineBaseFiles =
    input.baselineDiffPlan === null
      ? null
      : resolveProjectSourceFilePaths(
          input.rootDirectory,
          input.projectDirectory,
          input.baselineDiffPlan.baseFiles,
        );
  const projectBaselineHeadFiles =
    input.baselineDiffPlan === null
      ? null
      : resolveProjectSourceFilePaths(
          input.rootDirectory,
          input.projectDirectory,
          input.baselineDiffPlan.headFiles,
        );

  if (!input.isDiffMode) {
    return {
      includePaths: undefined,
      projectBaselineBaseFiles,
      projectBaselineHeadFiles,
      shouldSkipProject: false,
      supplyChainManifestChanged: false,
    };
  }

  const changedSourceFiles =
    input.diffInfo === null
      ? []
      : resolveProjectDiffIncludePaths(input.rootDirectory, input.projectDirectory, input.diffInfo);
  const supplyChainManifestChanged =
    input.supplyChainEnabled &&
    input.diffInfo !== null &&
    projectManifestChanged(input.rootDirectory, input.projectDirectory, input.diffInfo);
  const hasProjectBaselineBaseFiles = (projectBaselineBaseFiles?.length ?? 0) > 0;
  const shouldSkipProject =
    changedSourceFiles.length === 0 && !supplyChainManifestChanged && !hasProjectBaselineBaseFiles;

  const includePaths = [...changedSourceFiles];
  if (includePaths.length === 0 && hasProjectBaselineBaseFiles) {
    includePaths.push(...(projectBaselineBaseFiles ?? []));
  }
  if (supplyChainManifestChanged) includePaths.push("package.json");

  return {
    includePaths,
    projectBaselineBaseFiles,
    projectBaselineHeadFiles,
    shouldSkipProject,
    supplyChainManifestChanged,
  };
};
