import * as path from "node:path";
import * as fs from "node:fs";

export interface InstallGitHubWorkflowResult {
  readonly status: "created" | "exists" | "failed";
  readonly workflowPath: string;
}

// Self-documenting workflow file. Keep this intentionally direct: the repo no
// longer ships a composite action, so generated CI should install and invoke the
// published CLI like any other npm tool.
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
  # Scans \`main\` on every push so regressions that slipped past PR review
  # still show up in CI. Comment this block out if you only want PR-time scans.
  push:
    branches: [main]

permissions:
  contents: read

# Cancels any in-flight scan for the same PR (or branch, on push) the moment a new commit arrives, so reviewers only ever see the latest run.
concurrency:
  group: react-doctor-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v5
        with:
          node-version: 22

      # Common knobs:
      # - change "--blocking error" to "--blocking warning" to fail on warnings too
      # - change it to "--blocking none" for advisory-only rollout
      # - add "--project web,admin" in a monorepo to scan specific workspace projects
      - run: npx --yes react-doctor@latest . --blocking error
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
