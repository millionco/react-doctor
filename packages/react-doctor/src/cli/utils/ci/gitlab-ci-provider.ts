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
// pipeline GitLab exposes the target branch as this variable. A whole-project
// scan ("full") ignores the base, so it's left off.
const BASE_FLAG = ' --base "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"';

// True when `line` RUNS React Doctor — via a runner (`npx` / `pnpm dlx` /
// `yarn dlx` / `bunx`) or a bare `react-doctor` command. The leading `- `
// sequence marker is optional, so a command inside a multiline `script: - |`
// block scalar is matched too; a leading `#` (comment) and an
// `npm install react-doctor` step are excluded because the run must be the
// first token.
const isScanLine = (line: string): boolean => {
  const command = line.replace(/^\s*-?\s*/, "");
  if (command.startsWith("#")) return false;
  // `react-doctor` followed by `@`, whitespace, or end — the run. The trailing
  // class excludes the YAML job key `react-doctor:` and names like
  // `react-doctor-setup`.
  return /^(?:(?:npx|bunx|dlx|(?:pnpm|yarn)\s+dlx)\s+)?react-doctor(?:@|\s|$)/.test(command);
};

const stripTrailingComment = (line: string): string => line.replace(/\s+#.*$/, "");

const buildScanCommand = (gate: CiGate): string =>
  `npx react-doctor@latest --blocking ${gate.blocking} --scope ${gate.scope}${gate.scope === "full" ? "" : BASE_FLAG}`;

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
// flags are read off React Doctor's own scan line (with any trailing comment
// stripped), so a comment or another job can't be mistaken for the gate. The
// `['"]?` tolerates a hand-quoted value (`--blocking "error"`).
const parseGate = (content: string): CiGate => {
  const command = stripTrailingComment(content.split(/\r?\n/).find(isScanLine) ?? "");
  const blockingMatch = command.match(/--blocking[ =]['"]?([\w-]+)/);
  const scopeMatch = command.match(/--scope[ =]['"]?([\w-]+)/);
  const blocking =
    blockingMatch && isValidBlockingLevel(blockingMatch[1]) ? blockingMatch[1] : null;
  const scope = scopeMatch && isScopeValue(scopeMatch[1]) ? scopeMatch[1] : null;
  return {
    ...ADVISORY_GATE,
    blocking: blocking ?? ADVISORY_GATE.blocking,
    scope: scope ?? ADVISORY_GATE.scope,
  };
};

const containsReactDoctor = (content: string): boolean => content.split(/\r?\n/).some(isScanLine);

// Replaces a flag's value in place, or appends the flag when it isn't present,
// so a requested change always lands even if the user had removed the flag.
const upsertFlag = (command: string, flag: string, value: string): string => {
  const pattern = new RegExp(`(--${flag})[ =]\\S+`);
  return pattern.test(command)
    ? command.replace(pattern, `$1 ${value}`)
    : `${command} --${flag} ${value}`;
};

// Splices the gate flags on React Doctor's own scan line in place — preserving
// every other line and job, so a scan job folded into a larger pipeline edits
// cleanly. `--blocking` / `--scope` are set (added if missing); the canonical
// `--base` is dropped/re-added per scope (a user's custom `--base` is left
// alone), and a trailing comment is kept. Returns null when there's no scan
// line to edit (the caller then prints the snippet).
const applyGate = (content: string, gate: CiGate): CiEditResult | null => {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex(isScanLine);
  if (index === -1) return null;

  const commentMatch = lines[index].match(/\s+#.*$/);
  const comment = commentMatch ? commentMatch[0] : "";
  let command = comment
    ? lines[index].slice(0, lines[index].length - comment.length)
    : lines[index];

  command = upsertFlag(command, "blocking", gate.blocking);
  command = upsertFlag(command, "scope", gate.scope);
  command = command.replace(/\s*--base[ =]"\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"/, "");
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
  containsReactDoctor,
  scaffold,
  parseGate,
  applyGate,
  renderSnippet,
};
