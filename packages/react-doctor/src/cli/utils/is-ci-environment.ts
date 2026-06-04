// Narrow on canonical CI signals only — the ones that, on their own, should
// suppress the share URL (noise in CI logs) and mark the run CI-originated for
// the score path. Broader providers in CI_PROVIDER_BY_ENVIRONMENT_VARIABLE only
// label telemetry and otherwise rely on the universal `CI` flag. Does not imply
// `--no-score`.
export const CI_ENVIRONMENT_VARIABLES = ["GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"] as const;

// CI provider signature env var -> stable label, attached to crash reports as
// `ciProvider`. Order only matters when a runner sets several at once (first
// match wins).
const CI_PROVIDER_BY_ENVIRONMENT_VARIABLE: ReadonlyArray<readonly [string, string]> = [
  ["GITHUB_ACTIONS", "github-actions"],
  ["GITLAB_CI", "gitlab-ci"],
  ["CIRCLECI", "circleci"],
  ["BUILDKITE", "buildkite"],
  ["JENKINS_URL", "jenkins"],
  ["TF_BUILD", "azure-pipelines"],
  ["CODEBUILD_BUILD_ID", "aws-codebuild"],
  ["TEAMCITY_VERSION", "teamcity"],
  ["BITBUCKET_BUILD_NUMBER", "bitbucket"],
  ["TRAVIS", "travis"],
  ["DRONE", "drone"],
];

// Marker the official react-doctor GitHub Action sets on its scan step so CLI
// telemetry can tell "ran via our action" apart from a hand-rolled `npx
// react-doctor` step inside some GitHub workflow. Presence is all that matters;
// the value is the action ref.
export const GITHUB_ACTION_MARKER_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_GITHUB_ACTION";

// Action inputs the CLI can't otherwise see (they're handled in `action.yml`
// steps, not passed as flags). The official action forwards them as these env
// vars so the wide event can record how the action was configured. Exported so
// tests can save/restore the full surface.
export const ACTION_INPUT_ENVIRONMENT_VARIABLES = {
  failOn: "REACT_DOCTOR_ACTION_FAIL_ON",
  nonBlocking: "REACT_DOCTOR_ACTION_NON_BLOCKING",
  comment: "REACT_DOCTOR_ACTION_COMMENT",
  annotations: "REACT_DOCTOR_ACTION_ANNOTATIONS",
  version: "REACT_DOCTOR_ACTION_VERSION",
} as const;

// Coding-agent runtime marker env var -> stable brand label. Config-only or
// auth vars (e.g. OPENAI_API_KEY, OPENCODE_CONFIG) are intentionally excluded so
// a stored key doesn't read as "running inside an agent". This is the single
// source of truth for branded agent markers; the flat list and the boolean
// detectors below derive from it.
const CODING_AGENT_BY_ENVIRONMENT_VARIABLE: ReadonlyArray<readonly [string, string]> = [
  ["CLAUDECODE", "claude-code"],
  ["CLAUDE_CODE", "claude-code"],
  ["CURSOR_AGENT", "cursor"],
  ["CODEX_CI", "codex"],
  ["CODEX_SANDBOX", "codex"],
  ["CODEX_SANDBOX_NETWORK_DISABLED", "codex"],
  ["OPENCODE", "opencode"],
  ["GOOSE_TERMINAL", "goose"],
  ["AMP_THREAD_ID", "amp"],
];

// Generic "an agent is driving this" markers that signal an agent without
// identifying the brand.
const GENERIC_CODING_AGENT_ENVIRONMENT_VARIABLES = ["AGENT_SESSION_ID", "AGENT_THREAD_ID"] as const;

// Env vars whose *value* (not mere presence) names the agent.
export const CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES = ["AGENT"] as const;

const CODING_AGENT_ENVIRONMENT_VALUES = {
  AGENT: ["amp", "goose"],
} satisfies Record<(typeof CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES)[number], readonly string[]>;

// Every presence-based agent marker (branded + generic), derived so the brand
// map stays the single source of truth. Exposed for tests that clear/set the
// full agent signal surface.
export const CODING_AGENT_ENVIRONMENT_VARIABLES = [
  ...CODING_AGENT_BY_ENVIRONMENT_VARIABLE.map(([environmentVariable]) => environmentVariable),
  ...GENERIC_CODING_AGENT_ENVIRONMENT_VARIABLES,
] as const;

// CI providers set `CI` to "true", "1", or "True"; treat any value that isn't an
// explicit falsy marker as CI so `CI=1` isn't silently ignored.
const FALSY_CI_FLAG_VALUES = new Set(["", "0", "false"]);
const isCiFlagSet = (value: string | undefined): boolean =>
  value !== undefined && !FALSY_CI_FLAG_VALUES.has(value.toLowerCase());

export const isCiEnvironment = (): boolean =>
  CI_ENVIRONMENT_VARIABLES.some((environmentVariable) =>
    Boolean(process.env[environmentVariable]),
  ) || isCiFlagSet(process.env.CI);

// Resolves the CI provider brand for telemetry, falling back to "unknown" for a
// bare `CI` flag. Returns null when there's no CI signal at all.
export const detectCiProvider = (): string | null => {
  for (const [environmentVariable, provider] of CI_PROVIDER_BY_ENVIRONMENT_VARIABLE) {
    if (process.env[environmentVariable]) return provider;
  }
  return isCiFlagSet(process.env.CI) ? "unknown" : null;
};

// True when the run was launched by the official react-doctor GitHub Action
// (which sets the marker env var on its scan step).
export const isOfficialGithubAction = (): boolean =>
  Boolean(process.env[GITHUB_ACTION_MARKER_ENVIRONMENT_VARIABLE]);

// The triggering GitHub Actions event (`pull_request`, `push`, `schedule`,
// `workflow_dispatch`, …) from the runner-provided `GITHUB_EVENT_NAME`. Null
// off GitHub Actions. Low-cardinality, so safe as a run tag.
export const detectCiEventName = (): string | null => process.env.GITHUB_EVENT_NAME?.trim() || null;

// Whether the CI run was triggered by a pull request event.
export const isPullRequestCiEvent = (): boolean => {
  const eventName = detectCiEventName();
  return eventName === "pull_request" || eventName === "pull_request_target";
};

// The runner OS GitHub Actions exposes as `RUNNER_OS` (`Linux`/`Windows`/
// `macOS`). Null off GitHub Actions; the local `process.platform` covers the
// non-action case.
export const detectRunnerOs = (): string | null => process.env.RUNNER_OS?.trim() || null;

const detectCodingAgentFromValue = (): string | null => {
  for (const environmentVariable of CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES) {
    const value = process.env[environmentVariable]?.toLowerCase();
    if (value && CODING_AGENT_ENVIRONMENT_VALUES[environmentVariable].includes(value)) return value;
  }
  return null;
};

// Resolves the coding-agent brand for telemetry, or "unknown" for a generic
// agent marker. Returns null when no agent signal is present.
export const detectCodingAgent = (): string | null => {
  for (const [environmentVariable, agent] of CODING_AGENT_BY_ENVIRONMENT_VARIABLE) {
    if (process.env[environmentVariable]) return agent;
  }
  const agentFromValue = detectCodingAgentFromValue();
  if (agentFromValue) return agentFromValue;
  if (
    GENERIC_CODING_AGENT_ENVIRONMENT_VARIABLES.some(
      (environmentVariable) => process.env[environmentVariable],
    )
  ) {
    return "unknown";
  }
  return null;
};

export const isCodingAgentEnvironment = (): boolean => detectCodingAgent() !== null;

export const isCiOrCodingAgentEnvironment = (): boolean =>
  isCiEnvironment() || isCodingAgentEnvironment();
