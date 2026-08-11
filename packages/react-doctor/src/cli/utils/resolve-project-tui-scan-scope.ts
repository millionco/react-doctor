import type { ChangedFileLineRanges } from "@react-doctor/core";
import type { ReactDoctorInspectOptions } from "../../inspect-options.js";
import { projectManifestChanged } from "./project-manifest-changed.js";
import {
  resolveProjectChangedLineRanges,
  resolveProjectDiffIncludePaths,
} from "./resolve-project-diff-include-paths.js";
import { resolveProjectSourceFilePaths } from "./resolve-project-source-file-paths.js";
import type { TuiScanScopePlan } from "./resolve-tui-scan-scope.js";

export interface ProjectTuiScanScopeOptions {
  readonly baseline?: ReactDoctorInspectOptions["baseline"];
  readonly changedLineRanges?: ReadonlyArray<ChangedFileLineRanges>;
  readonly includePaths?: string[];
  readonly supplyChainManifestChanged?: boolean;
}

export interface ResolveProjectTuiScanScopeInput {
  readonly plan: TuiScanScopePlan;
  readonly projectDirectory: string;
  readonly rootDirectory: string;
  readonly supplyChainEnabled: boolean;
}

export const resolveProjectTuiScanScope = (
  input: ResolveProjectTuiScanScopeInput,
): ProjectTuiScanScopeOptions | null => {
  if (input.plan.scope === "full") return {};
  if (input.plan.diffInfo === null) return null;

  const changedSourceFiles = resolveProjectDiffIncludePaths(
    input.rootDirectory,
    input.projectDirectory,
    input.plan.diffInfo,
  );
  const baselineBaseFiles =
    input.plan.baselineDiffPlan === null
      ? null
      : resolveProjectSourceFilePaths(
          input.rootDirectory,
          input.projectDirectory,
          input.plan.baselineDiffPlan.baseFiles,
        );
  const baselineHeadFiles =
    input.plan.baselineDiffPlan === null
      ? null
      : resolveProjectSourceFilePaths(
          input.rootDirectory,
          input.projectDirectory,
          input.plan.baselineDiffPlan.headFiles,
        );
  const supplyChainManifestChanged =
    input.supplyChainEnabled &&
    projectManifestChanged(input.rootDirectory, input.projectDirectory, input.plan.diffInfo);
  const hasBaselineOnlyFiles = (baselineBaseFiles?.length ?? 0) > 0;

  if (!supplyChainManifestChanged && changedSourceFiles.length === 0 && !hasBaselineOnlyFiles) {
    return null;
  }

  const includePaths = [...changedSourceFiles];
  if (includePaths.length === 0 && hasBaselineOnlyFiles) {
    includePaths.push(...(baselineBaseFiles ?? []));
  }
  if (supplyChainManifestChanged) includePaths.push("package.json");

  return {
    includePaths,
    baseline:
      input.plan.baselineRef !== null && baselineBaseFiles !== null && baselineHeadFiles !== null
        ? {
            ref: input.plan.baselineRef,
            baseFiles: baselineBaseFiles,
            headFiles: baselineHeadFiles,
          }
        : undefined,
    changedLineRanges:
      input.plan.scope === "lines" && input.plan.changedLineRanges !== null
        ? resolveProjectChangedLineRanges(
            input.rootDirectory,
            input.projectDirectory,
            input.plan.changedLineRanges,
          )
        : undefined,
    supplyChainManifestChanged,
  };
};
