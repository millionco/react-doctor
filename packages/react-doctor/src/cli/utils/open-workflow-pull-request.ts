import * as path from "node:path";
import { detectDefaultBranch } from "./detect-default-branch.js";
import { isCommandAvailable } from "./is-command-available.js";
import { runCommand as run, type CommandRunner } from "./run-command.js";

const NEW_BRANCH_PREFIX = "react-doctor/add-github-actions";

const DEFAULT_COMMIT_MESSAGE = "ci: add React Doctor GitHub Actions workflow";

const DEFAULT_PR_TITLE = "Add React Doctor to GitHub Actions";

// Short body that lets the docs site carry the deeper explanation. The
// installed workflow file already has inline comments for every option, so
// the PR description doesn't need to re-explain them.
const DEFAULT_PR_BODY = `Adds a [React Doctor](https://www.react.doctor) scan to every pull request and every push to the default branch. The workflow file is documented inline.

Docs: https://www.react.doctor/ci`;

export type OpenWorkflowPullRequestResult =
  | { readonly status: "pr-opened"; readonly url: string }
  // Commit + push succeeded but \`gh pr create\` failed — the branch is on
  // the remote so the user can still open a PR manually.
  | { readonly status: "branch-pushed"; readonly branch: string }
  // Nothing was attempted (gh missing / not authed / not a git repo / etc.).
  // Caller should fall back to staging the workflow file in the working tree.
  | { readonly status: "not-attempted"; readonly reason: NotAttemptedReason };

export type NotAttemptedReason =
  | "gh-not-installed"
  | "gh-not-authenticated"
  | "not-a-git-repo"
  | "no-default-branch"
  | "detached-head"
  | "working-tree-dirty"
  | "checkout-failed"
  | "git-add-failed"
  | "git-commit-failed"
  | "git-push-failed";

// Tries `react-doctor/add-github-actions` first and appends a compact
// timestamp suffix if a local branch already exists with that name (avoids
// clobbering a previous attempt's branch).
const findUniqueBranchName = async (cwd: string, runner: CommandRunner): Promise<string> => {
  if (!(await runner("git", ["rev-parse", "--verify", NEW_BRANCH_PREFIX], cwd)).success) {
    return NEW_BRANCH_PREFIX;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${NEW_BRANCH_PREFIX}-${stamp}`;
};

// Best-effort: commits the just-written workflow file onto a fresh branch
// based on the default-branch tip, pushes it, and opens a pull request via
// `gh pr create`. Returns `"not-attempted"` (without modifying git state)
// when `gh` is missing, the working tree isn't a git repo, the user isn't
// authenticated, we can't find the default branch, or the checkout to the
// new branch would conflict with local working-tree modifications. Returns
// `"branch-pushed"` when the commit + push succeeded but `gh pr create`
// failed (so the user can still open the PR manually). Restores the
// original branch on success and on any mid-flight failure.
//
// Async so the chain no longer blocks the event loop and the caller's `ora`
// spinner keeps animating through the slow network steps. Each step still
// runs sequentially via `await` because it depends on the previous one.
export const openWorkflowPullRequest = async (
  params: {
    workflowPath: string;
    // Override the commit message / PR title + body. Defaults describe a fresh
    // install; the v1→v2 upgrade flow passes its own copy. The git/`gh` steps,
    // failure modes, and branch cleanup are identical either way — both just
    // commit the workflow file (newly written or modified in place) onto a
    // dedicated branch and open a PR.
    commitMessage?: string;
    prTitle?: string;
    prBody?: string;
    // Base branch for the PR. Callers that already resolved the repo's default
    // branch (to keep the installed workflow consistent with the PR base) pass
    // it here; when omitted it's detected from the repo.
    baseBranch?: string;
  },
  runner: CommandRunner = run,
): Promise<OpenWorkflowPullRequestResult> => {
  const workflowPath = path.resolve(params.workflowPath);
  const commitMessage = params.commitMessage ?? DEFAULT_COMMIT_MESSAGE;
  const prTitle = params.prTitle ?? DEFAULT_PR_TITLE;
  const prBody = params.prBody ?? DEFAULT_PR_BODY;

  // Probe from the workflow file's directory so we resolve the repo root
  // even when the CLI was invoked from a sub-package in a monorepo.
  const repoRootProbe = await runner(
    "git",
    ["rev-parse", "--show-toplevel"],
    path.dirname(workflowPath),
  );
  if (!repoRootProbe.success) return { status: "not-attempted", reason: "not-a-git-repo" };
  const cwd = repoRootProbe.stdout;

  if (!isCommandAvailable("gh")) return { status: "not-attempted", reason: "gh-not-installed" };
  if (!(await runner("gh", ["auth", "status"], cwd)).success) {
    return { status: "not-attempted", reason: "gh-not-authenticated" };
  }

  const defaultBranch = params.baseBranch ?? (await detectDefaultBranch(cwd, runner));
  if (!defaultBranch) return { status: "not-attempted", reason: "no-default-branch" };

  const previousBranchProbe = await runner("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!previousBranchProbe.success || previousBranchProbe.stdout === "HEAD") {
    return { status: "not-attempted", reason: "detached-head" };
  }
  const previousBranch = previousBranchProbe.stdout;

  const statusProbe = await runner("git", ["status", "--porcelain"], cwd);
  if (statusProbe.success) {
    const hasTrackedChanges = statusProbe.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => !line.startsWith("??"));
    if (hasTrackedChanges) {
      return { status: "not-attempted", reason: "working-tree-dirty" };
    }
  }

  // Best-effort fetch so `origin/<default>` is current; ignore failures
  // (offline, no auth for fetch) and let the next step fail loudly if the
  // ref genuinely isn't available.
  await runner("git", ["fetch", "origin", defaultBranch], cwd);

  const newBranch = await findUniqueBranchName(cwd, runner);

  if (
    !(await runner("git", ["checkout", "-b", newBranch, `origin/${defaultBranch}`], cwd)).success
  ) {
    return { status: "not-attempted", reason: "checkout-failed" };
  }

  // From here on, any failure has to restore the previous branch. Deleting
  // the new branch only matters when nothing's been pushed yet — once the
  // push lands we keep the branch so the user can still create the PR by
  // hand from the remote.
  const restoreToPreviousBranch = async (deleteNewBranch: boolean): Promise<void> => {
    await runner("git", ["checkout", previousBranch], cwd);
    if (deleteNewBranch) await runner("git", ["branch", "-D", newBranch], cwd);
  };

  const workflowRelative = path.relative(cwd, workflowPath);

  if (!(await runner("git", ["add", "--", workflowRelative], cwd)).success) {
    await restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-add-failed" };
  }

  if (!(await runner("git", ["commit", "-m", commitMessage], cwd)).success) {
    await restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-commit-failed" };
  }

  if (!(await runner("git", ["push", "-u", "origin", newBranch], cwd)).success) {
    await restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-push-failed" };
  }

  const prCreate = await runner(
    "gh",
    [
      "pr",
      "create",
      "--title",
      prTitle,
      "--body",
      prBody,
      "--base",
      defaultBranch,
      "--head",
      newBranch,
    ],
    cwd,
  );

  await restoreToPreviousBranch(false);

  if (!prCreate.success) return { status: "branch-pushed", branch: newBranch };

  // `gh pr create` prints the new PR URL on its last non-empty stdout line.
  const prUrl = prCreate.stdout.split(/\r?\n/).filter(Boolean).pop() ?? "";
  return { status: "pr-opened", url: prUrl };
};

// Stages the workflow file in the working tree so the user can `git commit`
// it themselves. Used as the fallback when `openWorkflowPullRequest` returns
// `"not-attempted"` and the file should still land in their next commit
// instead of sitting as an orphan untracked path. Returns whether the stage
// actually happened.
export const stageWorkflowFile = async (
  params: { workflowPath: string },
  runner: CommandRunner = run,
): Promise<boolean> => {
  const workflowPath = path.resolve(params.workflowPath);
  const repoRootProbe = await runner(
    "git",
    ["rev-parse", "--show-toplevel"],
    path.dirname(workflowPath),
  );
  if (!repoRootProbe.success) return false;
  const workflowRelative = path.relative(repoRootProbe.stdout, workflowPath);
  return (await runner("git", ["add", "--", workflowRelative], repoRootProbe.stdout)).success;
};
