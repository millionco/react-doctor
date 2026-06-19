import * as path from "node:path";
import { GH_PR_LIST_MAX } from "./constants.js";
import { detectDefaultBranch } from "./detect-default-branch.js";
import { isCommandAvailable } from "./is-command-available.js";
import { toForwardSlashes } from "./path-format.js";
import { runCommand, type CommandRunner } from "./run-command.js";

const NEW_BRANCH_PREFIX = "react-doctor/add-github-actions";

// One open PR returned by `gh pr list --json headRefName,url`. Only the two
// fields the idempotency check reads are modeled; `gh` emits more.
interface OpenPullRequestSummary {
  readonly headRefName?: string;
  readonly url?: string;
}

const DEFAULT_COMMIT_MESSAGE = "ci: add React Doctor GitHub Actions workflow";

const DEFAULT_PR_TITLE = "Add React Doctor to GitHub Actions";

// Short body that lets the docs site carry the deeper explanation. The
// installed workflow file already has inline comments for every option, so
// the PR description doesn't need to re-explain them.
const DEFAULT_PR_BODY = `Adds a [React Doctor](https://www.react.doctor) scan to every pull request and every push to the default branch. The workflow file is documented inline.

Docs: https://www.react.doctor/ci`;

export type OpenWorkflowPullRequestResult =
  | { readonly status: "pr-opened"; readonly url: string }
  // A React Doctor setup PR is already open — we surface it instead of
  // opening a duplicate (issue #904). Caller reports the existing URL.
  | { readonly status: "pr-exists"; readonly url: string }
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
  // The working tree has tracked (staged or unstaged) modifications, which
  // `git checkout -b` would carry onto the PR branch and the whole-index
  // `git commit` would sweep in alongside the workflow file (issue #904).
  | "working-tree-dirty"
  | "checkout-failed"
  | "git-add-failed"
  | "git-commit-failed"
  | "git-push-failed";

// Tries `react-doctor/add-github-actions` first and appends a compact
// timestamp suffix if a local branch already exists with that name (avoids
// clobbering a previous attempt's branch).
const findUniqueBranchName = async (cwd: string, run: CommandRunner): Promise<string> => {
  if (!(await run("git", ["rev-parse", "--verify", NEW_BRANCH_PREFIX], cwd)).success) {
    return NEW_BRANCH_PREFIX;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${NEW_BRANCH_PREFIX}-${stamp}`;
};

// Returns the already-open React Doctor setup PR, or null when none is open.
// Matches any head branch under the setup prefix so it catches both the
// canonical branch and earlier timestamped variants. Returns the matched PR
// itself (not just its URL) so the caller short-circuits on the PR's
// *existence* — never opening a duplicate even if `gh` omits the URL field.
// Best-effort: a failed or unparsable `gh` call returns null so setup still
// proceeds.
const findExistingSetupPullRequest = async (
  cwd: string,
  run: CommandRunner,
): Promise<OpenPullRequestSummary | null> => {
  const prList = await run(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--json",
      "headRefName,url",
      "--limit",
      String(GH_PR_LIST_MAX),
    ],
    cwd,
  );
  if (!prList.success) return null;
  try {
    const openPullRequests: OpenPullRequestSummary[] = JSON.parse(prList.stdout);
    return (
      openPullRequests.find((pullRequest) =>
        (pullRequest.headRefName ?? "").startsWith(NEW_BRANCH_PREFIX),
      ) ?? null
    );
  } catch {
    return null;
  }
};

// True when the working tree has tracked changes (staged or unstaged) to
// files OTHER than the workflow itself. `git checkout -b` carries those onto
// the fresh branch and the whole-index `git commit` would then sweep them
// into the PR (issue #904). The workflow file is excluded because it's the
// one change we *do* mean to commit — newly written (fresh install) or
// modified in place (the v1→v2 upgrade). Untracked entries (`??`) are
// ignored since the path-less commit never stages them. A failed probe is
// treated as dirty so we never risk bundling a user's work.
const hasUnrelatedTrackedChanges = async (
  cwd: string,
  workflowRelative: string,
  run: CommandRunner,
): Promise<boolean> => {
  const statusProbe = await run(
    "git",
    ["status", "--porcelain", "--", ".", `:!${workflowRelative}`],
    cwd,
  );
  if (!statusProbe.success) return true;
  return statusProbe.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .some((statusLine) => !statusLine.startsWith("??"));
};

// Best-effort: commits the just-written workflow file onto a fresh branch
// based on the default-branch tip, pushes it, and opens a pull request via
// `gh pr create`. Returns `"pr-exists"` (without modifying git state) when a
// React Doctor setup PR is already open, so a re-run never opens a duplicate.
// Returns `"not-attempted"` (without modifying git state) when `gh` is
// missing, the working tree isn't a git repo, the user isn't authenticated,
// the working tree has tracked modifications (which would otherwise be
// bundled into the PR), or we can't find the default branch. Returns
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
  // Base branch for the PR. Callers that already resolved the repo's default
  // branch (to keep the installed workflow consistent with the PR base) pass
  // it here; when omitted it's detected from the repo.
  baseBranch?: string;
  // Injectable runner / `gh`-availability probe so tests drive the flow
  // without spawning real `git` / `gh`. Production passes neither.
  run?: CommandRunner;
  checkCommandAvailable?: (command: string) => boolean;
}): Promise<OpenWorkflowPullRequestResult> => {
  const workflowPath = path.resolve(params.workflowPath);
  const commitMessage = params.commitMessage ?? DEFAULT_COMMIT_MESSAGE;
  const prTitle = params.prTitle ?? DEFAULT_PR_TITLE;
  const prBody = params.prBody ?? DEFAULT_PR_BODY;
  const run = params.run ?? runCommand;
  const checkCommandAvailable = params.checkCommandAvailable ?? isCommandAvailable;

  // Probe from the workflow file's directory so we resolve the repo root
  // even when the CLI was invoked from a sub-package in a monorepo.
  const repoRootProbe = await run(
    "git",
    ["rev-parse", "--show-toplevel"],
    path.dirname(workflowPath),
  );
  if (!repoRootProbe.success) return { status: "not-attempted", reason: "not-a-git-repo" };
  const cwd = repoRootProbe.stdout;
  // Forward slashes so the `:!` exclude pathspec and `git add` match git's
  // forward-slash-normalized repo paths on Windows (where `path.relative`
  // yields backslashes, which git's magic pathspec won't treat as separators).
  const workflowRelative = toForwardSlashes(path.relative(cwd, workflowPath));

  if (!checkCommandAvailable("gh")) return { status: "not-attempted", reason: "gh-not-installed" };
  if (!(await run("gh", ["auth", "status"], cwd)).success) {
    return { status: "not-attempted", reason: "gh-not-authenticated" };
  }

  // Idempotency: if a React Doctor setup PR is already open, surface it
  // rather than opening a duplicate. A re-run re-writes the workflow file
  // (it lives only on the prior PR's branch, not the user's working branch),
  // so without this guard `findUniqueBranchName` would mint a timestamped
  // branch and `gh pr create` would open a second PR for the same change
  // (issue #904).
  const existingSetupPullRequest = await findExistingSetupPullRequest(cwd, run);
  if (existingSetupPullRequest) {
    return { status: "pr-exists", url: existingSetupPullRequest.url ?? "" };
  }

  // Bail before touching any git state if the working tree carries unrelated
  // tracked changes: the checkout + whole-index commit below would otherwise
  // bundle the user's work into the PR. The caller falls back to staging the
  // workflow file so it still lands in their next commit.
  if (await hasUnrelatedTrackedChanges(cwd, workflowRelative, run)) {
    return { status: "not-attempted", reason: "working-tree-dirty" };
  }

  const defaultBranch = params.baseBranch ?? (await detectDefaultBranch(cwd, run));
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

  const newBranch = await findUniqueBranchName(cwd, run);

  // `git checkout -b <new> origin/<default>` carries the untracked workflow
  // file onto the new branch. The dirty-tree guard above guarantees nothing
  // else rides along, so the commit below only ever contains the workflow.
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
export const stageWorkflowFile = async (params: {
  workflowPath: string;
  run?: CommandRunner;
}): Promise<boolean> => {
  const workflowPath = path.resolve(params.workflowPath);
  const run = params.run ?? runCommand;
  const repoRootProbe = await run(
    "git",
    ["rev-parse", "--show-toplevel"],
    path.dirname(workflowPath),
  );
  if (!repoRootProbe.success) return false;
  const workflowRelative = toForwardSlashes(path.relative(repoRootProbe.stdout, workflowPath));
  return (await run("git", ["add", "--", workflowRelative], repoRootProbe.stdout)).success;
};
