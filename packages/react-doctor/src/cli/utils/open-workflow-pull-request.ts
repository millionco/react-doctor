import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { isCommandAvailable } from "./is-command-available.js";

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
  | "checkout-failed"
  | "git-add-failed"
  | "git-commit-failed"
  | "git-push-failed";

interface RunResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const execFileAsync = promisify(execFile);

// Async (was `spawnSync`) so the chain never blocks Node's event loop. While
// it blocked, the `ora` spinner in `setUpGitHubActions` couldn't advance its
// frames and looked frozen through the slow network steps (`gh auth status`,
// `git fetch`, `git push`, `gh pr create`). Output is captured into pipes,
// not inherited, so nothing interleaves with the spinner. `execFile` rejects
// on a non-zero exit (and on ENOENT); both carry the captured stdout/stderr
// on the error object.
const run = async (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<RunResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], { cwd, encoding: "utf8" });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return {
      success: false,
      stdout: (failure.stdout ?? "").trim(),
      stderr: (failure.stderr ?? "").trim(),
    };
  }
};

// Resolves the configured default branch of `origin` (the branch GitHub PRs
// land against). Reads `refs/remotes/origin/HEAD` first — git sets it when
// the remote was cloned or `git remote set-head` ran — then falls back to
// the conventional `main` / `master` so older repos still work.
const detectDefaultBranch = async (cwd: string): Promise<string | null> => {
  const symRef = await run("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (symRef.success) {
    const branchMatch = symRef.stdout.match(/refs\/remotes\/origin\/(.+)$/);
    if (branchMatch) return branchMatch[1];
  }
  if ((await run("git", ["rev-parse", "--verify", "origin/main"], cwd)).success) return "main";
  if ((await run("git", ["rev-parse", "--verify", "origin/master"], cwd)).success) return "master";
  return null;
};

// Tries `react-doctor/add-github-actions` first and appends a compact
// timestamp suffix if a local branch already exists with that name (avoids
// clobbering a previous attempt's branch).
const findUniqueBranchName = async (cwd: string): Promise<string> => {
  if (!(await run("git", ["rev-parse", "--verify", NEW_BRANCH_PREFIX], cwd)).success) {
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
export const openWorkflowPullRequest = async (params: {
  workflowPath: string;
  // Override the commit message / PR title + body. Defaults describe a fresh
  // install; the v1→v2 upgrade flow passes its own copy. The git/`gh` steps,
  // failure modes, and branch cleanup are identical either way — both just
  // commit the workflow file (newly written or modified in place) onto a
  // dedicated branch and open a PR.
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
}): Promise<OpenWorkflowPullRequestResult> => {
  const workflowPath = path.resolve(params.workflowPath);
  const commitMessage = params.commitMessage ?? DEFAULT_COMMIT_MESSAGE;
  const prTitle = params.prTitle ?? DEFAULT_PR_TITLE;
  const prBody = params.prBody ?? DEFAULT_PR_BODY;

  // Probe from the workflow file's directory so we resolve the repo root
  // even when the CLI was invoked from a sub-package in a monorepo.
  const repoRootProbe = await run(
    "git",
    ["rev-parse", "--show-toplevel"],
    path.dirname(workflowPath),
  );
  if (!repoRootProbe.success) return { status: "not-attempted", reason: "not-a-git-repo" };
  const cwd = repoRootProbe.stdout;

  if (!isCommandAvailable("gh")) return { status: "not-attempted", reason: "gh-not-installed" };
  if (!(await run("gh", ["auth", "status"], cwd)).success) {
    return { status: "not-attempted", reason: "gh-not-authenticated" };
  }

  const defaultBranch = await detectDefaultBranch(cwd);
  if (!defaultBranch) return { status: "not-attempted", reason: "no-default-branch" };

  const previousBranchProbe = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!previousBranchProbe.success || previousBranchProbe.stdout === "HEAD") {
    return { status: "not-attempted", reason: "detached-head" };
  }
  const previousBranch = previousBranchProbe.stdout;

  // Best-effort fetch so `origin/<default>` is current; ignore failures
  // (offline, no auth for fetch) and let the next step fail loudly if the
  // ref genuinely isn't available.
  await run("git", ["fetch", "origin", defaultBranch], cwd);

  const newBranch = await findUniqueBranchName(cwd);

  // `git checkout -b <new> origin/<default>` carries untracked files (the
  // just-written workflow) and refuses with a non-zero status if tracked
  // working-tree modifications would conflict with the destination — in
  // which case we bail out without touching anything else.
  if (!(await run("git", ["checkout", "-b", newBranch, `origin/${defaultBranch}`], cwd)).success) {
    return { status: "not-attempted", reason: "checkout-failed" };
  }

  // From here on, any failure has to restore the previous branch. Deleting
  // the new branch only matters when nothing's been pushed yet — once the
  // push lands we keep the branch so the user can still create the PR by
  // hand from the remote.
  const restoreToPreviousBranch = async (deleteNewBranch: boolean): Promise<void> => {
    await run("git", ["checkout", previousBranch], cwd);
    if (deleteNewBranch) await run("git", ["branch", "-D", newBranch], cwd);
  };

  const workflowRelative = path.relative(cwd, workflowPath);

  if (!(await run("git", ["add", "--", workflowRelative], cwd)).success) {
    await restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-add-failed" };
  }

  if (!(await run("git", ["commit", "-m", commitMessage], cwd)).success) {
    await restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-commit-failed" };
  }

  if (!(await run("git", ["push", "-u", "origin", newBranch], cwd)).success) {
    await restoreToPreviousBranch(true);
    return { status: "not-attempted", reason: "git-push-failed" };
  }

  const prCreate = await run(
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
export const stageWorkflowFile = async (params: { workflowPath: string }): Promise<boolean> => {
  const workflowPath = path.resolve(params.workflowPath);
  const repoRootProbe = await run(
    "git",
    ["rev-parse", "--show-toplevel"],
    path.dirname(workflowPath),
  );
  if (!repoRootProbe.success) return false;
  const workflowRelative = path.relative(repoRootProbe.stdout, workflowPath);
  return (await run("git", ["add", "--", workflowRelative], repoRootProbe.stdout)).success;
};
