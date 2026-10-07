import { getBaselineDiffPlan, getChangedLineRanges, getDiffInfo } from "@react-doctor/core";
import type {
  ChangedFileLineRanges,
  DiffInfo,
  GitBaselineDiffPlan,
  ReactDoctorConfig,
  ScopeValue,
} from "@react-doctor/core";
import type { InspectFlags } from "./inspect-flags.js";
import { cliLogger } from "./cli-logger.js";
import { resolveMergeBaseRef } from "./materialize-baseline-files.js";
import { finalizeScope, resolveScope } from "./resolve-scope.js";
import { validateIncludeUntrackedScope } from "./validate-mode-flags.js";

export interface TuiScanScopePlan {
  readonly baselineDiffPlan: GitBaselineDiffPlan | null;
  readonly baselineIntended: boolean;
  readonly baselineRef: string | null;
  readonly changedLineRanges: ReadonlyArray<ChangedFileLineRanges> | null;
  readonly diffInfo: DiffInfo | null;
  readonly scope: ScopeValue;
}

export interface ResolveTuiScanScopeInput {
  readonly directory: string;
  readonly flags: InspectFlags;
  readonly userConfig: ReactDoctorConfig | null;
}

export const resolveTuiScanScope = async (
  input: ResolveTuiScanScopeInput,
): Promise<TuiScanScopePlan> => {
  const requestedScope = resolveScope(input.flags, input.userConfig);
  const includeUntracked = input.flags.includeUntracked ?? false;
  validateIncludeUntrackedScope(includeUntracked, requestedScope.scope);
  const wantsDiff = requestedScope.scope !== undefined && requestedScope.scope !== "full";
  const diffInfo = wantsDiff
    ? await getDiffInfo(input.directory, requestedScope.base, includeUntracked)
    : null;
  const scope = await finalizeScope({
    requested: requestedScope,
    diffInfo,
    skipPrompts: true,
    isQuiet: false,
  });
  let comparisonBaseRef: string | null = null;
  if (scope !== "full" && diffInfo !== null && !diffInfo.isCurrentChanges) {
    if (diffInfo.baseSha !== undefined) {
      comparisonBaseRef = await resolveMergeBaseRef(input.directory, diffInfo.baseSha);
    } else if (diffInfo.diffBaseRef !== undefined) {
      comparisonBaseRef = diffInfo.diffBaseRef;
    } else {
      comparisonBaseRef = await resolveMergeBaseRef(input.directory, diffInfo.baseBranch);
    }
  }
  const baselineRef = scope === "changed" ? comparisonBaseRef : null;
  const baselineDiffPlan =
    baselineRef === null ? null : await getBaselineDiffPlan(input.directory, baselineRef);
  const linesBaseRef = diffInfo?.isCurrentChanges ? "HEAD" : comparisonBaseRef;
  const canComputeChangedLines =
    scope === "lines" && diffInfo !== null && (diffInfo.isCurrentChanges || linesBaseRef !== null);
  const changedLineRanges = canComputeChangedLines
    ? await getChangedLineRanges({
        directory: input.directory,
        baseRef: linesBaseRef ?? undefined,
        files: [...diffInfo.changedFiles],
        includeUntracked,
      })
    : null;
  if (scope === "lines" && changedLineRanges === null) {
    cliLogger.warn(
      "Could not determine changed lines (no base ref or git diff failed); reporting all issues in changed files.",
    );
    cliLogger.break();
  }

  return {
    baselineDiffPlan,
    baselineIntended: scope === "changed" && diffInfo !== null && !diffInfo.isCurrentChanges,
    baselineRef,
    changedLineRanges,
    diffInfo,
    scope,
  };
};
