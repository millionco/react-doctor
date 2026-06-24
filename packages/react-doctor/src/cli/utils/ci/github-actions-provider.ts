import * as path from "node:path";
import * as fs from "node:fs";
import {
  buildWorkflowContent,
  getReactDoctorWorkflowPath,
  readReactDoctorWorkflow,
  upgradeWorkflowActionToV2,
} from "../install-github-workflow.js";
import { isValidBlockingLevel } from "../resolve-blocking-level.js";
import { isScopeValue } from "../resolve-scope.js";
import { normalizeWorkflowContent } from "./normalize-workflow-content.js";
import {
  ADVISORY_GATE,
  gatesEqual,
  type CiEditResult,
  type CiGate,
  type CiProvider,
  type CiScaffoldResult,
  type CiWorkflowFile,
} from "./ci-provider.js";

// Indentation inside the generated workflow's job step. `- uses:` sits at six
// spaces, so its sibling `with:` aligns at eight and the gate keys nest at ten.
const WITH_INDENT = "        ";
const GATE_KEY_INDENT = "          ";

// Maps each gate field to the GitHub Action input name (action.yml). Booleans
// default to true and `scope`/`blocking` to "changed"/"none", so a fresh
// `with:` block only spells out the fields that deviate from those defaults.
const ACTION_INPUT_NAME = {
  blocking: "blocking",
  scope: "scope",
  comment: "comment",
  reviewComments: "review-comments",
  commitStatus: "commit-status",
} as const;

const buildGateLines = (gate: CiGate): ReadonlyArray<string> => {
  const lines: string[] = [];
  if (gate.blocking !== ADVISORY_GATE.blocking) {
    lines.push(`${GATE_KEY_INDENT}${ACTION_INPUT_NAME.blocking}: ${gate.blocking}`);
  }
  if (gate.scope !== ADVISORY_GATE.scope) {
    lines.push(`${GATE_KEY_INDENT}${ACTION_INPUT_NAME.scope}: ${gate.scope}`);
  }
  if (gate.comment !== ADVISORY_GATE.comment) {
    lines.push(`${GATE_KEY_INDENT}${ACTION_INPUT_NAME.comment}: ${gate.comment}`);
  }
  if (gate.reviewComments !== ADVISORY_GATE.reviewComments) {
    lines.push(`${GATE_KEY_INDENT}${ACTION_INPUT_NAME.reviewComments}: ${gate.reviewComments}`);
  }
  if (gate.commitStatus !== ADVISORY_GATE.commitStatus) {
    lines.push(`${GATE_KEY_INDENT}${ACTION_INPUT_NAME.commitStatus}: ${gate.commitStatus}`);
  }
  return lines;
};

// The active-gate workflow: a concrete `with:` block holding every setting that
// deviates from the advisory defaults. Used whenever the gate isn't advisory;
// an advisory gate produces the canonical commented template instead, so the
// two forms round-trip cleanly through `parseGate`.
const buildActiveWorkflow = (defaultBranch: string, gate: CiGate, actionRef: string): string =>
  `# React Doctor: security, performance, correctness, accessibility, bundle-size,
# and architecture checks for React.
#
# These settings were written by \`react-doctor ci config\`. Run it again to change them.
# Docs: https://www.react.doctor/ci

name: React Doctor

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  push:
    branches: ["${defaultBranch}"]

permissions:
  contents: read
  pull-requests: write
  issues: write
  statuses: write

concurrency:
  group: react-doctor-\${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: millionco/react-doctor@${actionRef}
${WITH_INDENT}with:
${buildGateLines(gate).join("\n")}
`;

const buildGithubWorkflow = (defaultBranch: string, gate: CiGate, actionRef: string): string =>
  gatesEqual(gate, ADVISORY_GATE)
    ? buildWorkflowContent(defaultBranch, actionRef)
    : buildActiveWorkflow(defaultBranch, gate, actionRef);

// The push-trigger branch (`branches: ["main"]`) the workflow already scans, so
// a `ci config` rewrite preserves it instead of reverting to a guessed default.
const extractDefaultBranch = (content: string): string | null => {
  const match = content.match(/branches:\s*\[\s*"([^"]+)"\s*\]/);
  return match ? match[1] : null;
};

// The action ref the `uses:` line carries (`v2`, `v1`, a tag, or a SHA), so a
// gate edit re-pins the same version rather than bumping the major.
const extractActionRef = (content: string): string | null => {
  const match = content.match(/millionco\/react-doctor@([\w.-]+)/);
  return match ? match[1] : null;
};

const parseBoolean = (raw: string, fallback: boolean): boolean => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
};

// Strips an inline `# comment` and any matching surrounding quotes, so a
// hand-written `blocking: "error"` reads the same as the bare `blocking: error`
// React Doctor generates.
const parseScalar = (raw: string): string =>
  raw
    .replace(/\s*#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");

// Reads the `with:` mapping React Doctor's own step currently applies. The
// search is anchored to the `millionco/react-doctor@…` line so a preceding
// step's `with:` block (e.g. actions/setup-node) is never mistaken for the
// gate. A step with no active `with:` reports the action's own defaults, so the
// gate the user sees in `ci config` matches what a scan actually does.
const parseGate = (content: string): CiGate => {
  const lines = content.split(/\r?\n/);
  const stepIndex = lines.findIndex((line) => /millionco\/react-doctor@/.test(line));
  if (stepIndex === -1) return ADVISORY_GATE;

  // The active `with:` for this step (a leading `#` rules out the commented
  // example the advisory template ships); stop at the next step.
  let withLineIndex = -1;
  for (let lineIndex = stepIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.trim() === "") continue;
    if (/^\s*-\s/.test(line)) break;
    if (/^\s*with:\s*$/.test(line)) {
      withLineIndex = lineIndex;
      break;
    }
  }
  if (withLineIndex === -1) return ADVISORY_GATE;

  const entries = new Map<string, string>();
  for (const line of lines.slice(withLineIndex + 1)) {
    if (line.trim() === "") continue;
    const keyValue = line.match(/^\s+([\w-]+):\s*(.+?)\s*$/);
    if (!keyValue) break;
    entries.set(keyValue[1], parseScalar(keyValue[2]));
  }

  const blockingRaw = entries.get(ACTION_INPUT_NAME.blocking);
  const scopeRaw = entries.get(ACTION_INPUT_NAME.scope);
  return {
    blocking:
      blockingRaw && isValidBlockingLevel(blockingRaw) ? blockingRaw : ADVISORY_GATE.blocking,
    scope: scopeRaw && isScopeValue(scopeRaw) ? scopeRaw : ADVISORY_GATE.scope,
    comment: parseBoolean(entries.get(ACTION_INPUT_NAME.comment) ?? "", ADVISORY_GATE.comment),
    reviewComments: parseBoolean(
      entries.get(ACTION_INPUT_NAME.reviewComments) ?? "",
      ADVISORY_GATE.reviewComments,
    ),
    commitStatus: parseBoolean(
      entries.get(ACTION_INPUT_NAME.commitStatus) ?? "",
      ADVISORY_GATE.commitStatus,
    ),
  };
};

// Rewrites the gate only when the file on disk is still exactly what React
// Doctor generates for its current gate (reconstructed from the parsed gate +
// the file's own branch and ref). That guarantees a hand-customized workflow is
// never silently overwritten: the caller falls back to printing the snippet.
const applyGate = (content: string, gate: CiGate): CiEditResult | null => {
  const defaultBranch = extractDefaultBranch(content) ?? "main";
  const actionRef = extractActionRef(content) ?? "v2";
  const currentGate = parseGate(content);
  const canonical = buildGithubWorkflow(defaultBranch, currentGate, actionRef);
  if (normalizeWorkflowContent(canonical) !== normalizeWorkflowContent(content)) return null;
  const next = buildGithubWorkflow(defaultBranch, gate, actionRef);
  return {
    content: next,
    changed: normalizeWorkflowContent(next) !== normalizeWorkflowContent(content),
  };
};

const renderSnippet = (gate: CiGate): string => {
  const gateLines = buildGateLines(gate);
  if (gateLines.length === 0) {
    return `${WITH_INDENT}# No \`with:\` block needed. The defaults are advisory (report, never fail).`;
  }
  return [`${WITH_INDENT}with:`, ...gateLines].join("\n");
};

const scaffold = (projectRoot: string, defaultBranch: string, gate: CiGate): CiScaffoldResult => {
  const workflowPath = getReactDoctorWorkflowPath(projectRoot);
  if (fs.existsSync(workflowPath)) return { status: "exists", path: workflowPath };
  try {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, buildGithubWorkflow(defaultBranch, gate, "v2"));
    return { status: "created", path: workflowPath };
  } catch {
    return { status: "failed", path: workflowPath };
  }
};

const readWorkflow = (projectRoot: string): CiWorkflowFile | null => {
  const workflow = readReactDoctorWorkflow(projectRoot);
  return workflow ? { path: workflow.workflowPath, content: workflow.content } : null;
};

export const githubActionsProvider: CiProvider = {
  id: "github-actions",
  displayName: "GitHub Actions",
  fileLabel: ".github/workflows/react-doctor.yml",
  supportedGateKeys: ["blocking", "scope", "comment", "reviewComments", "commitStatus"],
  supportsPullRequest: true,
  workflowPath: getReactDoctorWorkflowPath,
  readWorkflow,
  scaffold,
  parseGate,
  applyGate,
  renderSnippet,
  upgradeMajor: upgradeWorkflowActionToV2,
};
