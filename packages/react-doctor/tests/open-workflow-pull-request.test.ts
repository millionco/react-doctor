import { describe, expect, it } from "vite-plus/test";
import { openWorkflowPullRequest } from "../src/cli/utils/open-workflow-pull-request.js";
import type { CommandRunner, RunCommandResult } from "../src/cli/utils/run-command.js";

const succeed = (stdout = ""): RunCommandResult => ({ success: true, stdout, stderr: "" });
const fail = (): RunCommandResult => ({ success: false, stdout: "", stderr: "" });

const REPO_ROOT = "/repo";
const WORKFLOW_PATH = "/repo/.github/workflows/react-doctor.yml";
const WORKFLOW_RELATIVE = ".github/workflows/react-doctor.yml";

// Records every invocation so tests can assert which git/gh commands ran (and,
// crucially for issue #904, which ones did NOT). Keyed on "command arg1 arg2 …";
// anything unlisted resolves to `defaultResult` so happy-path tests only spell
// out the probes whose stdout matters.
const recordingRunner = (
  responses: Record<string, RunCommandResult>,
  defaultResult: RunCommandResult = succeed(),
): { run: CommandRunner; invocations: string[] } => {
  const invocations: string[] = [];
  const run: CommandRunner = (command, args) => {
    const invocation = [command, ...args].join(" ");
    invocations.push(invocation);
    return Promise.resolve(responses[invocation] ?? defaultResult);
  };
  return { run, invocations };
};

const TOPLEVEL = "git rev-parse --show-toplevel";
const GH_AUTH = "gh auth status";
const GH_PR_LIST = "gh pr list --state open --json headRefName,url --limit 100";
const GIT_STATUS = `git status --porcelain -- . :!${WORKFLOW_RELATIVE}`;
const HEAD_BRANCH = "git rev-parse --abbrev-ref HEAD";
const VERIFY_LOCAL_BRANCH = "git rev-parse --verify react-doctor/add-github-actions";
const CHECKOUT_NEW = "git checkout -b react-doctor/add-github-actions origin/main";
const GH_PR_CREATE =
  "gh pr create --title title --body body --base main --head react-doctor/add-github-actions";

// A clean tree on branch `feature` with no local setup branch and no open PR —
// the baseline every happy-path test starts from before overriding one probe.
const cleanRepoResponses = (): Record<string, RunCommandResult> => ({
  [TOPLEVEL]: succeed(REPO_ROOT),
  [GH_AUTH]: succeed(),
  [GH_PR_LIST]: succeed("[]"),
  [GIT_STATUS]: succeed(""),
  [HEAD_BRANCH]: succeed("feature"),
  [VERIFY_LOCAL_BRANCH]: fail(),
  [GH_PR_CREATE]: succeed("https://github.com/o/r/pull/42"),
});

const invoke = (responses: Record<string, RunCommandResult>) => {
  const { run, invocations } = recordingRunner(responses);
  const result = openWorkflowPullRequest({
    workflowPath: WORKFLOW_PATH,
    baseBranch: "main",
    commitMessage: "commit",
    prTitle: "title",
    prBody: "body",
    run,
    checkCommandAvailable: () => true,
  });
  return { result, invocations };
};

describe("openWorkflowPullRequest", () => {
  it("opens a PR and returns its URL on the happy path", async () => {
    const { result, invocations } = invoke(cleanRepoResponses());
    expect(await result).toEqual({
      status: "pr-opened",
      url: "https://github.com/o/r/pull/42",
    });
    // Issue #904, half 2: staging is path-scoped to the workflow file — never a
    // broad `git add -A`/`.`/`--all` that would sweep unrelated changes into the
    // commit. This is the line that stopped the deleted lockfile riding along.
    expect(invocations).toContain(`git add -- ${WORKFLOW_RELATIVE}`);
    expect(
      invocations.some(
        (invocation) =>
          invocation === "git add -A" ||
          invocation === "git add ." ||
          invocation.startsWith("git add --all"),
      ),
    ).toBe(false);
  });

  // Issue #904, half 1: a re-run must not open a duplicate. When a setup PR is
  // already open, surface it without minting a new (timestamped) branch.
  it("returns the existing PR instead of opening a duplicate", async () => {
    const { result, invocations } = invoke({
      ...cleanRepoResponses(),
      [GH_PR_LIST]: succeed(
        JSON.stringify([
          { headRefName: "react-doctor/add-github-actions", url: "https://github.com/o/r/pull/7" },
        ]),
      ),
    });
    expect(await result).toEqual({ status: "pr-exists", url: "https://github.com/o/r/pull/7" });
    expect(invocations.some((invocation) => invocation.startsWith("git checkout"))).toBe(false);
    expect(invocations.some((invocation) => invocation.startsWith("git commit"))).toBe(false);
  });

  // The duplicate guard must short-circuit on the matching PR's existence, not
  // on gh having reported a URL — otherwise a missing url would let a duplicate
  // through (the exact bug the guard exists to prevent).
  it("short-circuits on a matching setup PR even when gh omits the url", async () => {
    const { result, invocations } = invoke({
      ...cleanRepoResponses(),
      [GH_PR_LIST]: succeed(JSON.stringify([{ headRefName: "react-doctor/add-github-actions" }])),
    });
    expect(await result).toEqual({ status: "pr-exists", url: "" });
    expect(invocations.some((invocation) => invocation.startsWith("git checkout"))).toBe(false);
  });

  it("matches timestamped setup branches from earlier attempts", async () => {
    const { result } = invoke({
      ...cleanRepoResponses(),
      [GH_PR_LIST]: succeed(
        JSON.stringify([
          {
            headRefName: "react-doctor/add-github-actions-202606191729",
            url: "https://github.com/o/r/pull/19",
          },
        ]),
      ),
    });
    expect(await result).toEqual({ status: "pr-exists", url: "https://github.com/o/r/pull/19" });
  });

  it("ignores open PRs whose head branch isn't a setup branch", async () => {
    const { result } = invoke({
      ...cleanRepoResponses(),
      [GH_PR_LIST]: succeed(
        JSON.stringify([{ headRefName: "feature/login", url: "https://github.com/o/r/pull/3" }]),
      ),
    });
    expect((await result).status).toBe("pr-opened");
  });

  // Issue #904, half 2: a dirty tree must not be swept into the PR.
  it("bails when the working tree has unrelated tracked changes", async () => {
    const { result, invocations } = invoke({
      ...cleanRepoResponses(),
      [GIT_STATUS]: succeed(" M src/app.tsx\nD  pnpm-lock.yaml"),
    });
    expect(await result).toEqual({ status: "not-attempted", reason: "working-tree-dirty" });
    // The whole #904-half-2 guarantee is that a dirty tree touches no git write
    // state — assert the harmful operations were all skipped, not just checkout.
    for (const writeCommand of ["git checkout", "git add", "git commit", "git push"]) {
      expect(invocations.some((invocation) => invocation.startsWith(writeCommand))).toBe(false);
    }
  });

  it("allows untracked files (they're never committed) and opens the PR", async () => {
    const { result } = invoke({
      ...cleanRepoResponses(),
      [GIT_STATUS]: succeed("?? notes.txt\n?? scratch/"),
    });
    expect((await result).status).toBe("pr-opened");
  });

  it("scopes the dirty check so the workflow file's own change is allowed", async () => {
    // The status probe excludes the workflow path, so the upgrade flow (which
    // modifies the tracked workflow in place) is never flagged as dirty.
    const { result, invocations } = invoke(cleanRepoResponses());
    expect((await result).status).toBe("pr-opened");
    expect(invocations).toContain(GIT_STATUS);
  });

  it("checks for an existing PR before checking the working tree", async () => {
    // An open setup PR wins even when the tree is dirty — the more useful signal.
    const { result } = invoke({
      ...cleanRepoResponses(),
      [GIT_STATUS]: succeed(" M src/app.tsx"),
      [GH_PR_LIST]: succeed(
        JSON.stringify([
          { headRefName: "react-doctor/add-github-actions", url: "https://github.com/o/r/pull/7" },
        ]),
      ),
    });
    expect(await result).toEqual({ status: "pr-exists", url: "https://github.com/o/r/pull/7" });
  });

  it("proceeds when gh pr list fails or returns unparsable output", async () => {
    const { result } = invoke({ ...cleanRepoResponses(), [GH_PR_LIST]: succeed("not json") });
    expect((await result).status).toBe("pr-opened");
  });

  it("reports branch-pushed when the push lands but gh pr create fails", async () => {
    const { result, invocations } = invoke({ ...cleanRepoResponses(), [GH_PR_CREATE]: fail() });
    expect(await result).toEqual({
      status: "branch-pushed",
      branch: "react-doctor/add-github-actions",
    });
    // branch-pushed promises the branch survives on the remote for a manual PR —
    // the pushed branch must NOT be deleted, and the original branch is restored.
    expect(invocations.some((invocation) => invocation.startsWith("git branch -D"))).toBe(false);
    expect(invocations).toContain("git checkout feature");
  });

  it("reports gh-not-installed before probing for an existing PR", async () => {
    const { run, invocations } = recordingRunner(cleanRepoResponses());
    const result = await openWorkflowPullRequest({
      workflowPath: WORKFLOW_PATH,
      baseBranch: "main",
      run,
      checkCommandAvailable: () => false,
    });
    expect(result).toEqual({ status: "not-attempted", reason: "gh-not-installed" });
    expect(invocations).not.toContain(GH_PR_LIST);
  });
});
