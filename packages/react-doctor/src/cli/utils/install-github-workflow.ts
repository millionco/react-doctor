import * as path from "node:path";
import * as fs from "node:fs";

export interface InstallGitHubWorkflowResult {
  readonly status: "created" | "exists" | "failed";
  readonly workflowPath: string;
}

// Self-documenting workflow file. It installs advisory-first: the action's
// `blocking` input defaults to `none`, so the check never fails on day one —
// every PR still gets the full report (sticky comment, inline review comments,
// a commit-status score). The push trigger scans the repo's actual default
// branch (`master`, `develop`, …) — not a hardcoded `main`. The inline YAML
// comments give a new user one-line explanations of each trigger and show how
// to graduate the gate (uncomment `with:` and set `blocking: error`), without
// forcing them off to the docs site to learn the basics. The action itself is
// pinned to the floating major `@v2` (never `@main`, per the supply-chain
// guidance in AGENTS.md): `@main` would run whatever HEAD points to with
// `pull-requests: write` granted.
// `actionRef` is the floating-major (or pin) the `uses:` line carries. It
// defaults to the current major so fresh installs always pin `@v2`; the
// `ci config` round-trip passes the ref it read back so editing a workflow's
// gate never silently bumps its version across a major boundary.
export const buildWorkflowContent = (
  defaultBranch: string,
  actionRef: string = "v2",
): string => `# React Doctor — finds security, performance, correctness, accessibility,
# bundle-size, and architecture issues in React codebases.
#
# Docs: https://www.react.doctor/ci
# Source: https://github.com/millionco/react-doctor

name: React Doctor

on:
  # Scans the PR's changed files and posts a sticky summary comment listing only the new issues introduced relative to the merge base of the target branch.
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  # Scans \`${defaultBranch}\` on every push to track the health-score trend and catch regressions that slipped past PR review.
  push:
    branches: ["${defaultBranch}"]

permissions:
  contents: read
  pull-requests: write
  issues: write
  statuses: write

# Cancels any in-flight scan for the same PR (or branch, on push) the moment a new commit arrives, so reviewers only ever see the latest run.
concurrency:
  group: react-doctor-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: millionco/react-doctor@${actionRef}
        # Advisory by default: React Doctor reports findings on every PR — a
        # sticky summary comment, inline review comments, and a commit status
        # with the health score — but never fails the check, so it won't red-X
        # a teammate's PR on day one. When your team trusts the signal, graduate
        # the gate: uncomment the block below and set blocking to "error" (fail
        # on new error-severity findings) or "warning" (fail on any finding).
        # Full reference: https://www.react.doctor/ci
        # with:
        #   blocking: error          # Gate level: "none" (advisory, the default) | "warning" | "error"
        #   scope: full              # On PRs, scan the whole project instead of just changed files
        #   comment: false           # Disable the sticky PR summary comment
        #   review-comments: false   # Disable inline review comments on changed lines
        #   commit-status: false     # Disable the commit status (score + counts, links to the run)
        #   version: "0.4.0"         # Pin to a specific react-doctor version instead of "latest"
        #   directory: apps/web      # Scan a sub-directory (default: ".")
        #   project: "web,admin"     # In a monorepo, scan specific workspace project(s)
`;

export const getReactDoctorWorkflowPath = (projectRoot: string): string =>
  path.join(projectRoot, ".github", "workflows", "react-doctor.yml");

export const isReactDoctorWorkflowInstalled = (projectRoot: string): boolean =>
  fs.existsSync(getReactDoctorWorkflowPath(projectRoot));

// Matches ONLY the floating-major action ref this template installs
// (`millionco/react-doctor@v1`). The negative lookahead excludes exact tags
// (`@v1.2.3`) and SHA pins (`@<sha> # v1.1.1`) — those are deliberate version
// locks we must not silently move across a major boundary, so the upgrade
// offer is scoped to the floating ref we ship by default.
const V1_FLOATING_ACTION_REF = String.raw`millionco/react-doctor@v1(?![\w.])`;
const V2_FLOATING_ACTION_REF = "millionco/react-doctor@v2";

export interface InstalledReactDoctorWorkflow {
  readonly workflowPath: string;
  readonly content: string;
}

// Reads the canonical `.github/workflows/react-doctor.yml` if present. Returns
// null when it's absent or unreadable (the upgrade offer simply doesn't fire).
export const readReactDoctorWorkflow = (
  projectRoot: string,
): InstalledReactDoctorWorkflow | null => {
  const workflowPath = getReactDoctorWorkflowPath(projectRoot);
  try {
    return { workflowPath, content: fs.readFileSync(workflowPath, "utf8") };
  } catch {
    return null;
  }
};

// True when the workflow still pins the action's previous floating major.
export const workflowUsesV1Action = (content: string): boolean =>
  new RegExp(V1_FLOATING_ACTION_REF).test(content);

// Rewrites the floating `@v1` ref(s) to `@v2`, leaving everything else
// (formatting, comments, inputs, any exact/SHA pins) untouched. `changed` is
// false when there was nothing to bump.
export const upgradeWorkflowActionToV2 = (
  content: string,
): { readonly content: string; readonly changed: boolean } => {
  const upgraded = content.replace(new RegExp(V1_FLOATING_ACTION_REF, "g"), V2_FLOATING_ACTION_REF);
  return { content: upgraded, changed: upgraded !== content };
};

// Writes `.github/workflows/react-doctor.yml`, creating the workflows
// directory if needed. Returns "exists" without overwriting a workflow that's
// already there, and "failed" (rather than throwing) so callers can degrade to
// printing manual setup instructions. `defaultBranch` lands in the template's
// push trigger; callers resolve it via `detectDefaultBranch` and fall back to
// `main` when the repo has no detectable default.
export const installReactDoctorWorkflow = (
  projectRoot: string,
  defaultBranch: string = "main",
): InstallGitHubWorkflowResult => {
  const workflowPath = getReactDoctorWorkflowPath(projectRoot);
  if (fs.existsSync(workflowPath)) return { status: "exists", workflowPath };

  try {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, buildWorkflowContent(defaultBranch));
    return { status: "created", workflowPath };
  } catch {
    return { status: "failed", workflowPath };
  }
};

export interface UpgradeGitHubWorkflowResult {
  // "upgraded": the floating `@v1` ref was rewritten to `@v2` in place.
  // "not-needed": no workflow on disk, or it doesn't pin the floating `@v1`.
  // "failed": the rewrite couldn't be persisted (read-only / permission FS).
  readonly status: "upgraded" | "not-needed" | "failed";
  readonly workflowPath: string;
}

// Rewrites an existing `.github/workflows/react-doctor.yml` from the action's
// previous floating major (`@v1`) to `@v2` in place, leaving everything else
// untouched. Mirrors `installReactDoctorWorkflow`'s "write to the working tree,
// user reviews + commits" contract for the `install` flow — the PR-opening
// upgrade variant lives in the post-scan handoff. Returns "failed" (rather than
// throwing) so callers can degrade gracefully.
export const upgradeReactDoctorWorkflowInPlace = (
  projectRoot: string,
): UpgradeGitHubWorkflowResult => {
  const workflow = readReactDoctorWorkflow(projectRoot);
  if (!workflow)
    return {
      status: "not-needed",
      workflowPath: getReactDoctorWorkflowPath(projectRoot),
    };

  const { content, changed } = upgradeWorkflowActionToV2(workflow.content);
  if (!changed) return { status: "not-needed", workflowPath: workflow.workflowPath };

  try {
    fs.writeFileSync(workflow.workflowPath, content);
    return { status: "upgraded", workflowPath: workflow.workflowPath };
  } catch {
    return { status: "failed", workflowPath: workflow.workflowPath };
  }
};
