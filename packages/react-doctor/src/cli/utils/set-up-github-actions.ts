import { CI_URL, highlighter } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import {
  findNearestPackageDirectory,
  installReactDoctorScriptStep,
} from "./install-doctor-script.js";
import { installReactDoctorWorkflow } from "./install-github-workflow.js";
import { openWorkflowPullRequest, stageWorkflowFile } from "./open-workflow-pull-request.js";
import { reportWorkflowResult } from "./report-workflow-result.js";
import { spinner } from "./spinner.js";

export interface SetUpGitHubActionsOptions {
  readonly rootDirectory: string;
}

// Sets React Doctor up to scan every pull request: writes the GitHub Actions
// workflow + adds a `doctor` package script (which runs
// `npx react-doctor@latest`, no local dep required). The local dev-dep install
// isn't called from this path: nothing here needs it, and on pnpm with a beta
// channel it noisily trips the supply-chain trust guard for zero user benefit.
// Users who want a pinned local copy go through the `react-doctor install`
// command. Resolves the nearest package root first so a nested scan directory
// doesn't drop the workflow in the wrong place. The script step throws on a
// read-only / permission-denied FS, so it's guarded: a failed setup must never
// crash a scan that already succeeded.
//
// When the workflow is freshly written AND the user has `gh` installed,
// `openWorkflowPullRequest` commits the YAML on a dedicated branch and opens a
// PR for review — that matches the "everything else lands as a reviewable PR"
// mental model teams already have for CI changes, instead of silently dropping
// a top-level workflow file into their working tree. On any failure (gh
// missing, not authenticated, push refused, …) we fall back to `git add`ing the
// file so it at least shows up in the user's next `git status` / commit instead
// of becoming an orphan untracked path.
//
// Returns whether a workflow was freshly written, so callers can record
// accurate activation telemetry.
export const setUpGitHubActions = async (options: SetUpGitHubActionsOptions): Promise<boolean> => {
  const projectRoot = findNearestPackageDirectory(options.rootDirectory) ?? options.rootDirectory;
  try {
    installReactDoctorScriptStep(projectRoot);
  } catch {}

  const workflowSpinner = spinner("Adding GitHub Actions workflow...").start();
  const workflowResult = installReactDoctorWorkflow(projectRoot);
  const didCreateWorkflow = reportWorkflowResult(workflowSpinner, workflowResult, projectRoot);

  logger.break();
  if (workflowResult.status === "failed") {
    logger.log(
      `  Couldn't set up GitHub Actions automatically. Follow the guide at ${highlighter.info(CI_URL)}`,
    );
    return false;
  }

  if (workflowResult.status === "created") {
    const pullRequestSpinner = spinner("Opening a pull request for review...").start();
    const pullRequestResult = await openWorkflowPullRequest({
      workflowPath: workflowResult.workflowPath,
    });
    if (pullRequestResult.status === "pr-opened") {
      pullRequestSpinner.succeed(
        `Opened pull request for review: ${highlighter.info(pullRequestResult.url)}`,
      );
    } else if (pullRequestResult.status === "branch-pushed") {
      pullRequestSpinner.warn(
        `Pushed branch ${highlighter.bold(pullRequestResult.branch)} but couldn't open a PR. Open one with: gh pr create --head ${pullRequestResult.branch}`,
      );
    } else {
      pullRequestSpinner.stop();
      const didStage = await stageWorkflowFile({ workflowPath: workflowResult.workflowPath });
      logger.log(
        didStage
          ? `  Staged the workflow file. Commit it to start scanning every pull request.`
          : "  React Doctor will now scan every new pull request automatically.",
      );
    }
  }

  logger.log(`  Learn more: ${highlighter.info(CI_URL)}`);
  return didCreateWorkflow;
};
