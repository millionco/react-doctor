/**
 * Regression tests for openWorkflowPullRequest — guards against bundling
 * unrelated local changes into setup PRs.
 *
 * Covered closed issues:
 *   #904 — Setup flow must refuse to create a PR when the working tree has
 *          tracked changes (staged or unstaged). The fix checks
 *          `git status --porcelain` before checkout and only proceeds if the
 *          working tree is clean (untracked files like the just-written
 *          workflow are allowed). Prevents local uncommitted changes from
 *          being bundled into the React Doctor setup PR.
 */

import { describe, expect, it } from "vite-plus/test";
import { openWorkflowPullRequest } from "../src/cli/utils/open-workflow-pull-request.js";
import type { CommandRunner, RunCommandResult } from "../src/cli/utils/run-command.js";

const succeed = (stdout: string): RunCommandResult => ({
  success: true,
  stdout,
  stderr: "",
});

const fail = (): RunCommandResult => ({
  success: false,
  stdout: "",
  stderr: "",
});

const fakeRunner = (responses: Record<string, RunCommandResult>): CommandRunner => {
  return (command, args) => {
    const invocation = [command, ...args].join(" ");
    return Promise.resolve(responses[invocation] ?? fail());
  };
};

describe("openWorkflowPullRequest", () => {
  it("refuses to create a PR when working tree has tracked changes", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": succeed("/repo"),
      "gh auth status": succeed(""),
      "gh repo view --json defaultBranchRef --jq .defaultBranchRef.name": succeed("main"),
      "git rev-parse --abbrev-ref HEAD": succeed("feature-branch"),
      "git status --porcelain": succeed("M  src/app.ts\n A  src/new-file.ts"),
    });

    const result = await openWorkflowPullRequest(
      {
        workflowPath: "/repo/.github/workflows/react-doctor.yml",
        baseBranch: "main",
      },
      runner,
    );

    expect(result.status).toBe("not-attempted");
    if (result.status === "not-attempted") {
      expect(result.reason).toBe("working-tree-dirty");
    }
  });

  it("allows untracked files in working tree", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": succeed("/repo"),
      "gh auth status": succeed(""),
      "gh repo view --json defaultBranchRef --jq .defaultBranchRef.name": succeed("main"),
      "git rev-parse --abbrev-ref HEAD": succeed("main"),
      "git status --porcelain": succeed("?? .github/workflows/react-doctor.yml"),
      "git fetch origin main": succeed(""),
      "git rev-parse --verify react-doctor/add-github-actions": fail(),
      "git checkout -b react-doctor/add-github-actions origin/main": succeed(""),
      "git add -- .github/workflows/react-doctor.yml": succeed(""),
      "git commit -m ci: add React Doctor GitHub Actions workflow": succeed(""),
      "git push -u origin react-doctor/add-github-actions": succeed(""),
      "gh pr create --title Add React Doctor to GitHub Actions --body Adds a [React Doctor](https://www.react.doctor) scan to every pull request and every push to the default branch. The workflow file is documented inline.\n\nDocs: https://www.react.doctor/ci --base main --head react-doctor/add-github-actions":
        succeed("https://github.com/owner/repo/pull/1"),
      "git checkout main": succeed(""),
    });

    const result = await openWorkflowPullRequest(
      {
        workflowPath: "/repo/.github/workflows/react-doctor.yml",
        baseBranch: "main",
      },
      runner,
    );

    expect(result.status).toBe("pr-opened");
    if (result.status === "pr-opened") {
      expect(result.url).toBe("https://github.com/owner/repo/pull/1");
    }
  });

  it("refuses when working tree has staged changes", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": succeed("/repo"),
      "gh auth status": succeed(""),
      "gh repo view --json defaultBranchRef --jq .defaultBranchRef.name": succeed("main"),
      "git rev-parse --abbrev-ref HEAD": succeed("main"),
      "git status --porcelain": succeed("A  src/new-feature.ts\n?? .github/workflows/react-doctor.yml"),
    });

    const result = await openWorkflowPullRequest(
      {
        workflowPath: "/repo/.github/workflows/react-doctor.yml",
        baseBranch: "main",
      },
      runner,
    );

    expect(result.status).toBe("not-attempted");
    if (result.status === "not-attempted") {
      expect(result.reason).toBe("working-tree-dirty");
    }
  });

  it("refuses when working tree has unstaged tracked changes", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": succeed("/repo"),
      "gh auth status": succeed(""),
      "gh repo view --json defaultBranchRef --jq .defaultBranchRef.name": succeed("main"),
      "git rev-parse --abbrev-ref HEAD": succeed("main"),
      "git status --porcelain": succeed(" M src/modified.ts"),
    });

    const result = await openWorkflowPullRequest(
      {
        workflowPath: "/repo/.github/workflows/react-doctor.yml",
        baseBranch: "main",
      },
      runner,
    );

    expect(result.status).toBe("not-attempted");
    if (result.status === "not-attempted") {
      expect(result.reason).toBe("working-tree-dirty");
    }
  });

  it("refuses when working tree has deleted files", async () => {
    const runner = fakeRunner({
      "git rev-parse --show-toplevel": succeed("/repo"),
      "gh auth status": succeed(""),
      "gh repo view --json defaultBranchRef --jq .defaultBranchRef.name": succeed("main"),
      "git rev-parse --abbrev-ref HEAD": succeed("main"),
      "git status --porcelain": succeed(" D src/deleted.ts"),
    });

    const result = await openWorkflowPullRequest(
      {
        workflowPath: "/repo/.github/workflows/react-doctor.yml",
        baseBranch: "main",
      },
      runner,
    );

    expect(result.status).toBe("not-attempted");
    if (result.status === "not-attempted") {
      expect(result.reason).toBe("working-tree-dirty");
    }
  });
});
