// Narrow on canonical CI signals only. Used to suppress the share
// URL (noise in CI logs) and to mark the run as CI-originated for
// the score path. Does not imply `--no-score`.
export const CI_ENVIRONMENT_VARIABLES = ["GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"] as const;

// Runtime markers set by coding-agent subprocesses. Do not include
// config-only or auth vars such as OPENAI_API_KEY or OPENCODE_CONFIG.
export const CODING_AGENT_ENVIRONMENT_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "OPENCODE",
  "GOOSE_TERMINAL",
  "AGENT_SESSION_ID",
  "AMP_THREAD_ID",
  "AGENT_THREAD_ID",
] as const;

export const CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES = ["AGENT"] as const;

const CODING_AGENT_ENVIRONMENT_VALUES = {
  AGENT: ["amp", "goose"],
} satisfies Record<(typeof CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES)[number], readonly string[]>;

export const isCiEnvironment = (): boolean =>
  CI_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable])) ||
  process.env.CI === "true";

export const isCodingAgentEnvironment = (): boolean =>
  CODING_AGENT_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable])) ||
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES.some((envVariable) =>
    CODING_AGENT_ENVIRONMENT_VALUES[envVariable].some(
      (value) => process.env[envVariable]?.toLowerCase() === value,
    ),
  );

export const isCiOrCodingAgentEnvironment = (): boolean =>
  isCiEnvironment() || isCodingAgentEnvironment();
