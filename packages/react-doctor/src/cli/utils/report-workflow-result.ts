import * as path from "node:path";
import { METRIC } from "./constants.js";
import type { InstallGitHubWorkflowResult } from "./install-github-workflow.js";
import { recordCount } from "./record-metric.js";
import { spinner } from "./spinner.js";

type SpinnerHandle = ReturnType<ReturnType<typeof spinner>["start"]>;

// Renders a workflow-install outcome on an existing spinner and counts the
// `install.workflow` activation, so the `install` command and the post-scan
// GitHub Actions handoff report fresh workflow writes identically.
export const reportWorkflowResult = (
  workflowSpinner: SpinnerHandle,
  result: InstallGitHubWorkflowResult,
  projectRoot: string,
): boolean => {
  if (result.status === "failed") {
    workflowSpinner.fail("Couldn't write the GitHub Actions workflow.");
    return false;
  }
  if (result.status === "exists") {
    workflowSpinner.succeed("GitHub Actions workflow already configured.");
    return false;
  }
  workflowSpinner.succeed(
    `GitHub Actions workflow added at ${path.relative(projectRoot, result.workflowPath)}.`,
  );
  recordCount(METRIC.installWorkflow, 1, { kind: "create" });
  return true;
};
