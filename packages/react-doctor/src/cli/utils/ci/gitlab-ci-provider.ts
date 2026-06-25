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

// GitLab keeps its gate in the scan command's flags rather than a mapping. The
// flags are read off React Doctor's own scan line, not file-wide, so a merged
// pipeline that runs other jobs (or tools) with their own `--blocking` /
// `--scope` can't be mistaken for the gate. The `['"]?` tolerates a hand-quoted
// value (`--blocking "error"`).
const parseGate = (content: string): CiGate => {
  // The scan command is a YAML sequence item (`- npx react-doctor@latest …`);
  // requiring the `- ` prefix and stripping any trailing `# comment` keeps a
  // comment line (or an inline note) from being read as the gate.
  const scanLine = (
    content
      .split(/\r?\n/)
      .find(
        (line) =>
          /^\s*-\s/.test(line) && /react-doctor/.test(line) && /--(blocking|scope)\b/.test(line),
      ) ?? ""
  ).replace(/#.*$/, "");
  const blockingMatch = scanLine.match(/--blocking[ =]['"]?([\w-]+)/);
  const scopeMatch = scanLine.match(/--scope[ =]['"]?([\w-]+)/);
  const blocking =
    blockingMatch && isValidBlockingLevel(blockingMatch[1]) ? blockingMatch[1] : null;
  const scope = scopeMatch && isScopeValue(scopeMatch[1]) ? scopeMatch[1] : null;
  return {
    ...ADVISORY_GATE,
    blocking: blocking ?? ADVISORY_GATE.blocking,
    scope: scope ?? ADVISORY_GATE.scope,
  };
};

const BASE_FLAG = ' --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"';

// Splices the gate flags on React Doctor's own scan line in place — preserving
// every other line and job, so a scan job folded into a larger pipeline edits
// cleanly. Only `--blocking` / `--scope` values change; the canonical `--base`
// is dropped/re-added per scope (a user's custom `--base` is left alone), and a
// trailing comment is kept. Returns null when there's no scan line to edit.
const applyGate = (content: string, gate: CiGate): CiEditResult | null => {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex(
    (line) =>
      /^\s*-\s/.test(line) && /react-doctor/.test(line) && /--(blocking|scope)\b/.test(line),
  );
  if (index === -1) return null;

  // Edit only the command, re-attaching any trailing `# comment` verbatim.
  const commentMatch = lines[index].match(/\s+#.*$/);
  const comment = commentMatch ? commentMatch[0] : "";
  let command = comment
    ? lines[index].slice(0, lines[index].length - comment.length)
    : lines[index];

  command = command
    .replace(/--blocking[ =]\S+/, `--blocking ${gate.blocking}`)
    .replace(/--scope[ =]\S+/, `--scope ${gate.scope}`)
    .replace(/\s*--base[ =]"\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"/, "");
  if (gate.scope !== "full" && !/--base\b/.test(command)) command = `${command}${BASE_FLAG}`;

  lines[index] = `${command}${comment}`;
  const next = lines.join(newline);
  return { content: next, changed: next !== content };
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
