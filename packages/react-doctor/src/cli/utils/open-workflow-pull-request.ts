import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { isCommandAvailable } from "./is-command-available.js";

const NEW_BRANCH_PREFIX = "react-doctor/add-github-actions";

const COMMIT_MESSAGE = "ci: add React Doctor GitHub Actions workflow";

const PR_TITLE = "Add React Doctor to GitHub Actions";

// Short body that lets the docs site carry the deeper explanation. The
// installed workflow file already has inline comments for every option, so
// the PR description doesn't need to re-explain them.
const PR_BODY = `Adds a [React Doctor](https://www.react.doctor) scan to every pull request and every push to the default branch. The workflow file is documented inline.

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
  | "checkout-failed"
  | "git-add-failed"
  | "git-commit-failed"
  | "git-push-failed";

interface RunResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (command: string, args: ReadonlyArray<string>, cwd: string): RunResult => {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  return {
    success: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
};

// Resolves the configured default branch of `origin` (the branch GitHub PRs
// land against). Reads `refs/remotes/origin/HEAD` first — git sets it when
// the remote was cloned or `git remote set-head` ran — then falls back to
// the conventional `main` / `master` so older repos still work.
const detectDefaultBranch = (cwd: string): string | null => {
  const symRef = run("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (symRef.success) {
    const branchMatch = symRef.stdout.match(/refs\/remotes\/origin\/(.+)$/);
    if (branchMatch) return branchMatch[1];
  }
  if (run("git", ["rev-parse", "--verify", "origin/main"], cwd).success) return "main";
  if (run("git", ["rev-parse", "--verify", "origin/master"], cwd).success) return "master";
  return null;
};

// Tries `react-doctor/add-github-actions` first and appends a compact
// timestamp suffix if a local branch already exists with that name (avoids
// clobbering a previous attempt's branch).
const findUniqueBranchName = (cwd: string): string => {
  if (!run("git", ["rev-parse", "--verify", NEW_BRANCH_PREFIX], cwd).success) {
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
// Sync (uses `spawnSync`) because each step depends on the previous one
// and `setUpGitHubActions` is already a synchronous block; using `spawn`
// would interleave terminal output across the spinner above.
export const openWorkflowPullRequest = (params: {
  workflowPath: string;
}): OpenWorkflowPullRequestResult => {
  const workflowPath = path.resolve(params.workflowPath);

  // Probe from the workflow file's directory so we resolve the repo root
  // even when the CLI was invoked from a sub-package in a monorepo.
  const repoRootProbe = run("git", ["rev-parse", "--show-toplevel"], path.dirname(workflowPath));
  if (!repoRootProbe.success) return { status: "not-attempted", reason: "not-a-git-repo" };
  const cwd = repoRootProbe.stdout;

  if (!isCommandAvailable("gh")) return { status: "not-attempted", reason: "gh-not-installed" };
  if (!run("gh", ["auth", "status"], cwd).success) {
    return { status: "not-attempted", reason: "gh-not-authenticated" };
  }

  const defaultBranch = detectDefaultBranch(cwd);
  if (!defaultBranch) return { status: "not-attempted", reason: "no-default-branch" };

  const previousBranchProbe = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!previousBranchProbe.success || previousBranchProbe.stdout === "HEAD") {
    return { status: "not-attempted", reason: "detached-head" };
  }
  const previousBranch = previousBranchProbe.stdout;

  // Best-effort fetch so `origin/<default>` is current; ignore failures
  // (offline, no auth for fetch) and let the next step fail loudly if the
  // ref genuinely isn't available.
  run("git", ["fetch", "origin", defaultBranch], cwd);

  const newBranch = findUniqueBranchName(cwd);

  // `git checkout -b <new> origin/<default>` carries untracked files (the
  // just-written workflow) and refuses with a non-zero status if tracked
  // working-tree modifications would conflict with the destination — in
  // which case we bail out without touching anything else.
  if (!run("git", ["checkout", "-b", newBranch, `origin/${defaultBranch}`], cwd).success) {
    return { status: "not-attempted", reason: "checkout-failed" };
  }

  // From here on, any failure has to restore the previous branch. Deleting
  // the new branch only matters when nothing's been pushed yet — once the
  // push lands we keep the branch so the user can still create the PR by
  // hand from the remote.
  const restoreToPreviousBranch = (deleteNewBranch: boolean): void => {
    run("git", ["checkout", previousBranch], cwd);
    if (deleteNewBranch) run("git", ["branch", "-D", newBranch], cwd);
  };

  const workflowRelative = path.relative(cwd, workflowPath);

  if (!run("git", ["add", "--", workflowRelative], cwd).success) {
    restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-add-failed" };
  }

  if (!run("git", ["commit", "-m", COMMIT_MESSAGE], cwd).success) {
    restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-commit-failed" };
  }

  if (!run("git", ["push", "-u", "origin", newBranch], cwd).success) {
    restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-push-failed" };
  }

  const prCreate = run(
    "gh",
    [
      "pr",
      "create",
      "--title",
      PR_TITLE,
      "--body",
      PR_BODY,
      "--base",
      defaultBranch,
      "--head",
      newBranch,
    ],
    cwd,
  );

  restoreToPreviousBranch(false);

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
export const stageWorkflowFile = (params: { workflowPath: string }): boolean => {
  const workflowPath = path.resolve(params.workflowPath);
  const repoRootProbe = run("git", ["rev-parse", "--show-toplevel"], path.dirname(workflowPath));
  if (!repoRootProbe.success) return false;
  const workflowRelative = path.relative(repoRootProbe.stdout, workflowPath);
  return run("git", ["add", "--", workflowRelative], repoRootProbe.stdout).success;
};
