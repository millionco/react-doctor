import * as path from "node:path";
import * as fs from "node:fs";
import { isValidBlockingLevel } from "../resolve-blocking-level.js";
import { isScopeValue } from "../resolve-scope.js";
import {
  ADVISORY_GATE,
  type CiEditResult,
  type CiGate,
  type CiProvider,
  type CiScaffoldResult,
  type CiWorkflowFile,
} from "./ci-provider.js";
import { normalizeWorkflowContent } from "./normalize-workflow-content.js";

const GITLAB_CONFIG_FILENAME = ".gitlab-ci.yml";

const getGitlabConfigPath = (projectRoot: string): string =>
  path.join(projectRoot, GITLAB_CONFIG_FILENAME);

// A diff-based scope needs a base to compare against; on a merge-request
// pipeline GitLab exposes the target branch as `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`.
// A whole-project scan ("full") ignores the base, so it's left off.
const buildScanCommand = (gate: CiGate): string => {
  const baseFlag = gate.scope === "full" ? "" : ' --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"';
  return `npx react-doctor@latest --blocking ${gate.blocking} --scope ${gate.scope}${baseFlag}`;
};

// A single GitLab CI job that scans every merge request. GitLab has no React
// Doctor comment or commit-status reporter yet, so the scaffold is gate-only:
// it sets the pass/fail behavior and reports findings in the job log. Push
// pipelines on the default branch are left out because a diff scope has no
// merge-request target to compare against there.
const buildGitlabConfig = (
  gate: CiGate,
): string => `# React Doctor: security, performance, correctness, accessibility, bundle-size,
# and architecture checks for React.
#
# These settings were written by \`react-doctor ci config\`. Run it again to change them.
# Docs: https://www.react.doctor/ci

react-doctor:
  image: node:lts
  script:
    - ${buildScanCommand(gate)}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
`;

// GitLab keeps its gate in the scan command's flags rather than a mapping, so
// the parser reads `--blocking` / `--scope` straight off the `npx` line. The
// `['"]?` tolerates a hand-quoted value (`--blocking "error"`).
const parseGate = (content: string): CiGate => {
  const blockingMatch = content.match(/--blocking[ =]['"]?([\w-]+)/);
  const scopeMatch = content.match(/--scope[ =]['"]?([\w-]+)/);
  const blocking =
    blockingMatch && isValidBlockingLevel(blockingMatch[1]) ? blockingMatch[1] : null;
  const scope = scopeMatch && isScopeValue(scopeMatch[1]) ? scopeMatch[1] : null;
  return {
    ...ADVISORY_GATE,
    blocking: blocking ?? ADVISORY_GATE.blocking,
    scope: scope ?? ADVISORY_GATE.scope,
  };
};

// Edits the gate only when the file is still exactly the React Doctor scaffold
// (reconstructed from its own parsed gate). A user who folded the job into a
// larger pipeline gets the paste snippet instead of an overwrite.
const applyGate = (content: string, gate: CiGate): CiEditResult | null => {
  const canonical = buildGitlabConfig(parseGate(content));
  if (normalizeWorkflowContent(canonical) !== normalizeWorkflowContent(content)) return null;
  const next = buildGitlabConfig(gate);
  return {
    content: next,
    changed: normalizeWorkflowContent(next) !== normalizeWorkflowContent(content),
  };
};

// Never overwrites an existing `.gitlab-ci.yml`: most repos already have one
// with unrelated jobs, so an existing file reports "exists" and the caller
// prints the job to paste in.
const scaffold = (projectRoot: string, _defaultBranch: string, gate: CiGate): CiScaffoldResult => {
  const configPath = getGitlabConfigPath(projectRoot);
  if (fs.existsSync(configPath)) return { status: "exists", path: configPath };
  try {
    fs.writeFileSync(configPath, buildGitlabConfig(gate));
    return { status: "created", path: configPath };
  } catch {
    return { status: "failed", path: configPath };
  }
};

const readWorkflow = (projectRoot: string): CiWorkflowFile | null => {
  const configPath = getGitlabConfigPath(projectRoot);
  try {
    return { path: configPath, content: fs.readFileSync(configPath, "utf8") };
  } catch {
    return null;
  }
};

const renderSnippet = (gate: CiGate): string => buildGitlabConfig(gate).trimEnd();

export const gitlabCiProvider: CiProvider = {
  id: "gitlab-ci",
  displayName: "GitLab CI/CD",
  fileLabel: GITLAB_CONFIG_FILENAME,
  supportedGateKeys: ["blocking", "scope"],
  supportsPullRequest: false,
  workflowPath: getGitlabConfigPath,
  readWorkflow,
  scaffold,
  parseGate,
  applyGate,
  renderSnippet,
};
