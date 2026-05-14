// HACK: env vars that mean "user is not at an interactive shell." We use this
// to skip prompts but NOT to auto-flip --offline, because dev shells often
// have JENKINS_URL / TF_BUILD set as ambient config without actually running
// in CI.
const NON_INTERACTIVE_ENVIRONMENT_VARIABLES = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "BUILDKITE",
  "JENKINS_URL",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
  "TEAMCITY_VERSION",
  "BITBUCKET_BUILD_NUMBER",
  "CIRCLECI",
  "TRAVIS",
  "DRONE",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
];

export const isNonInteractiveEnvironment = (): boolean =>
  NON_INTERACTIVE_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable]));
