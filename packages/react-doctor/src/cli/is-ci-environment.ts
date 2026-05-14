// HACK: only flip --offline by default for the narrowest set of CI signals
// where we're confident the run is automated and a share URL would be
// useless. Other tools that set non-interactive env vars (Jenkins agents,
// Azure DevOps tasks running interactively, agentic coding sessions) still
// get telemetry-on-by-default; users can pass --offline explicitly.
const CI_ENVIRONMENT_VARIABLES = ["GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"];

export const isCiEnvironment = (): boolean =>
  CI_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable])) ||
  process.env.CI === "true";
