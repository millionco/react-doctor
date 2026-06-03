import * as path from "node:path";
import * as fs from "node:fs";

export interface InstallGitHubWorkflowResult {
  readonly status: "created" | "exists" | "failed";
  readonly workflowPath: string;
}

// The action is pinned to the floating major `@v1` (never `@main`, per the
// supply-chain guidance in AGENTS.md): `@main` would run whatever HEAD points
// to with `pull-requests: write` granted.
const buildWorkflowContent = (): string =>
  [
    "name: React Doctor",
    "",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize, reopened, ready_for_review]",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write",
    "  issues: write",
    "",
    "concurrency:",
    "  group: react-doctor-${{ github.event.pull_request.number || github.ref }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  react-doctor:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v5",
    "      - uses: millionco/react-doctor@v1",
    "",
  ].join("\n");

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
