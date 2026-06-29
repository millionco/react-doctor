import * as path from "node:path";
import * as fs from "node:fs";
import * as YAML from "yaml";
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

// The five gate fields paired with their action-input names, for iterating when
// reading or writing the `with:` mapping.
const MANAGED_INPUTS = Object.entries(ACTION_INPUT_NAME) as ReadonlyArray<
  [keyof typeof ACTION_INPUT_NAME, string]
>;

const ACTION_REF_PREFIX = "millionco/react-doctor@";

// Locates React Doctor's own step in a parsed workflow and its active `with:`
// mapping (null when the step has none). Anchored to the step's `uses` scalar
// (any ref, including a SHA pin), so a comment mentioning the action or a
// sibling step's `with:` block is never mistaken for the gate.
const findReactDoctorStep = (
  doc: YAML.Document.Parsed,
): { step: YAML.YAMLMap; withMap: YAML.YAMLMap | null } | null => {
  const jobs = doc.get("jobs");
  if (!YAML.isMap(jobs)) return null;
  for (const jobPair of jobs.items) {
    const job = jobPair.value;
    if (!YAML.isMap(job)) continue;
    const steps = job.get("steps");
    if (!YAML.isSeq(steps)) continue;
    for (const step of steps.items) {
      if (!YAML.isMap(step)) continue;
      const uses = step.get("uses");
      if (typeof uses === "string" && uses.startsWith(ACTION_REF_PREFIX)) {
        const withNode = step.get("with");
        return { step, withMap: YAML.isMap(withNode) ? withNode : null };
      }
    }
  }
  return null;
};

// Per-level indentation the file uses, so a `yaml` re-stringify matches a
// consistently-indented workflow instead of forcing the 2-space default.
const detectIndent = (content: string): number => {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^( +)\S/);
    if (match) return Math.max(2, match[1].length);
  }
  return 2;
};

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

// Reads the `with:` mapping React Doctor's own step currently applies, via the
// YAML AST so comments, a preceding step's `with:`, and quoted scalars can't
// fool it. A step with no active `with:` (or an unparseable file) reports the
// action's own defaults, so the gate the user sees in `ci config` matches what
// a scan actually does.
const parseGate = (content: string): CiGate => {
  let withMap: YAML.YAMLMap | null;
  try {
    withMap = findReactDoctorStep(YAML.parseDocument(content))?.withMap ?? null;
  } catch {
    return ADVISORY_GATE;
  }
  if (withMap === null) return ADVISORY_GATE;

  const readInput = (input: string): string | undefined => {
    const value = withMap.get(input);
    return value === undefined || value === null ? undefined : String(value);
  };
  const blockingRaw = readInput(ACTION_INPUT_NAME.blocking);
  const scopeRaw = readInput(ACTION_INPUT_NAME.scope);
  return {
    blocking:
      blockingRaw && isValidBlockingLevel(blockingRaw) ? blockingRaw : ADVISORY_GATE.blocking,
    scope: scopeRaw && isScopeValue(scopeRaw) ? scopeRaw : ADVISORY_GATE.scope,
    comment: parseBoolean(readInput(ACTION_INPUT_NAME.comment) ?? "", ADVISORY_GATE.comment),
    reviewComments: parseBoolean(
      readInput(ACTION_INPUT_NAME.reviewComments) ?? "",
      ADVISORY_GATE.reviewComments,
    ),
    commitStatus: parseBoolean(
      readInput(ACTION_INPUT_NAME.commitStatus) ?? "",
      ADVISORY_GATE.commitStatus,
    ),
  };
};

// Surgically edits React Doctor's step `with:` mapping in place, setting the
// keys that deviate from the advisory defaults and deleting those that return
// to a default (so the block stays minimal and round-trips). Comments, the
// action ref, and the step's other inputs (directory / project / node-version /
// version) are preserved by the YAML AST. An empty `with:` is removed entirely.
// Returns null when the file doesn't parse or has no React Doctor step.
const surgicalApplyGate = (content: string, gate: CiGate): CiEditResult | null => {
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(content);
  } catch {
    return null;
  }
  const located = findReactDoctorStep(doc);
  if (located === null) return null;

  let withMap = located.withMap;
  if (withMap === null) {
    withMap = new YAML.YAMLMap();
    located.step.set("with", withMap);
  }
  for (const [field, input] of MANAGED_INPUTS) {
    if (gate[field] === ADVISORY_GATE[field]) {
      withMap.delete(input);
    } else {
      withMap.set(input, gate[field]);
    }
  }
  if (withMap.items.length === 0) located.step.delete("with");

  const next = doc.toString({ flowCollectionPadding: false, indent: detectIndent(content) });
  return { content: next, changed: next !== content };
};

// Two paths: a pristine scaffold is rebuilt from the template (the cleanest
// diff, and it restores the commented advisory block when graduating back to
// advisory); any other workflow that contains the React Doctor step is edited
// surgically in place. Only a file with no React Doctor step (or unparseable
// YAML) is refused — the caller then prints the snippet.
const applyGate = (content: string, gate: CiGate): CiEditResult | null => {
  const defaultBranch = extractDefaultBranch(content) ?? "main";
  const actionRef = extractActionRef(content) ?? "v2";
  const currentGate = parseGate(content);
  const canonical = buildGithubWorkflow(defaultBranch, currentGate, actionRef);
  if (normalizeWorkflowContent(canonical) === normalizeWorkflowContent(content)) {
    const next = buildGithubWorkflow(defaultBranch, gate, actionRef);
    return {
      content: next,
      changed: normalizeWorkflowContent(next) !== normalizeWorkflowContent(content),
    };
  }
  return surgicalApplyGate(content, gate);
};

const renderSnippet = (gate: CiGate): string => {
  const gateLines = buildGateLines(gate);
  if (gateLines.length === 0) {
    return `${WITH_INDENT}# No \`with:\` block needed. The defaults are advisory (report, never fail).`;
  }
  return [`${WITH_INDENT}with:`, ...gateLines].join("\n");
};

const containsReactDoctor = (content: string): boolean => {
  try {
    return findReactDoctorStep(YAML.parseDocument(content)) !== null;
  } catch {
    return false;
  }
};

// Scans `.github/workflows/*.{yml,yaml}` for the first file that wires up the
// React Doctor action step — a user may have added the step to their existing
// CI workflow instead of a dedicated `react-doctor.yml`.
const findActionWorkflowFile = (projectRoot: string): CiWorkflowFile | null => {
  const workflowsDir = path.join(projectRoot, ".github", "workflows");
  let entries: string[];
  try {
    entries = fs.readdirSync(workflowsDir).sort();
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/\.ya?ml$/.test(entry)) continue;
    try {
      const content = fs.readFileSync(path.join(workflowsDir, entry), "utf8");
      if (containsReactDoctor(content)) return { path: path.join(workflowsDir, entry), content };
    } catch {}
  }
  return null;
};

// The canonical `react-doctor.yml` when present (it's ours, so edit it), else
// the first other workflow that wires up the action — so `ci config` /
// `ci upgrade` manage the step wherever the user put it.
const readWorkflow = (projectRoot: string): CiWorkflowFile | null => {
  const canonical = readReactDoctorWorkflow(projectRoot);
  if (canonical) return { path: canonical.workflowPath, content: canonical.content };
  return findActionWorkflowFile(projectRoot);
};

// Reports "exists" when the action is already wired up anywhere (or our
// canonical file is present), so `ci install` never adds a second workflow.
const scaffold = (projectRoot: string, defaultBranch: string, gate: CiGate): CiScaffoldResult => {
  const existing = readWorkflow(projectRoot);
  if (existing) return { status: "exists", path: existing.path };
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

export const githubActionsProvider: CiProvider = {
  id: "github-actions",
  displayName: "GitHub Actions",
  fileLabel: ".github/workflows/react-doctor.yml",
  supportedGateKeys: ["blocking", "scope", "comment", "reviewComments", "commitStatus"],
  supportsPullRequest: true,
  workflowPath: getReactDoctorWorkflowPath,
  readWorkflow,
  containsReactDoctor,
  scaffold,
  parseGate,
  applyGate,
  renderSnippet,
  upgradeMajor: upgradeWorkflowActionToV2,
};
