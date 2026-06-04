import * as path from "node:path";
import * as fs from "node:fs";

export interface InstallGitHubWorkflowResult {
  readonly status: "created" | "exists" | "failed";
  readonly workflowPath: string;
}

// Self-documenting workflow file. The inline YAML comments walk a new user
// through the three things they need to change first (non-blocking rollout,
// scanning `main` on every push for a quality-trend graph, suppressing PR
// comments) and explain why each permission is granted — without forcing
// them off to the docs site to learn the basics. The action itself is pinned
// to the floating major `@v1` (never `@main`, per the supply-chain guidance
// in AGENTS.md): `@main` would run whatever HEAD points to with
// `pull-requests: write` granted.
const buildWorkflowContent =
  (): string => `# React Doctor — finds security, performance, correctness, accessibility,
# bundle-size, and architecture issues in React codebases.
#
# Docs: https://www.react.doctor/ci
# Source: https://github.com/millionco/react-doctor

name: React Doctor

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  # Scans \`main\` on every push so you get a health-score trend on the
  # default branch — useful for tracking the overall number commit-by-commit
  # and catching regressions that slipped past PR review. PR-specific steps
  # (the sticky summary comment) are skipped automatically on \`push\` events.
  # Comment this block out if you only want PR-time scans.
  push:
    branches: [main]

permissions:
  # \`actions/checkout\` needs this to read the repo source.
  contents: read
  # Two uses: (1) reads the PR's changed-file list so the scan only checks
  # what the PR touched (faster, scoped to the diff), and (2) posts/updates
  # the sticky React Doctor summary comment on the PR. Downgrade \`write\` to
  # \`read\` to keep the changed-file scan but disable comment posting.
  pull-requests: write
  # The sticky-comment step uses GitHub's \`issues.createComment\` /
  # \`issues.updateComment\` endpoints — those are the same APIs that back PR
  # comments (PRs are issues under the hood). Not exercised on \`push\`
  # events, so safe to drop if you only run on \`main\`.
  issues: write

# Cancels any in-flight scan for the same PR (or branch, on push) the moment
# a new commit arrives, so reviewers only ever see the latest run.
concurrency:
  group: react-doctor-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: millionco/react-doctor@v1
        # Common configuration knobs — uncomment any to override the default.
        # Full reference: https://www.react.doctor/ci
        # with:
        #   non-blocking: true       # Report findings but always exit 0 (won't fail the PR check)
        #   fail-on: warning         # Gate level: "error" (default) | "warning" | "none"
        #   comment: false           # Disable the sticky PR summary comment
        #   annotations: false       # Disable inline GitHub Actions annotations on changed files
        #   version: "0.2.18"        # Pin to a specific react-doctor version instead of "latest"
        #   directory: apps/web      # Scan a sub-directory (default: ".")
        #   project: "web,admin"     # In a monorepo, scan specific workspace project(s)
`;

export const getReactDoctorWorkflowPath = (projectRoot: string): string =>
  path.join(projectRoot, ".github", "workflows", "react-doctor.yml");

export const isReactDoctorWorkflowInstalled = (projectRoot: string): boolean =>
  fs.existsSync(getReactDoctorWorkflowPath(projectRoot));

// Writes `.github/workflows/react-doctor.yml`, creating the workflows
// directory if needed. Returns "exists" without overwriting a workflow that's
// already there, and "failed" (rather than throwing) so callers can degrade to
// printing manual setup instructions.
export const installReactDoctorWorkflow = (projectRoot: string): InstallGitHubWorkflowResult => {
  const workflowPath = getReactDoctorWorkflowPath(projectRoot);
  if (fs.existsSync(workflowPath)) return { status: "exists", workflowPath };

  try {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, buildWorkflowContent());
    return { status: "created", workflowPath };
  } catch {
    return { status: "failed", workflowPath };
  }
};
