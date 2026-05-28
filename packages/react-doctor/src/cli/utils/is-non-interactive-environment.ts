import { isCodingAgentEnvironment } from "./is-ci-environment.js";

// HACK: env vars that mean "user is not at an interactive shell." We use this
// to skip prompts and disable the spinner animation but NOT to auto-flip
// --no-score, because dev shells often have JENKINS_URL / TF_BUILD set as
// ambient config without actually running in CI.
//
// `GIT_DIR` is set by git itself whenever it invokes a hook (per
// `git-hooks(5)`), which covers lefthook, husky, simple-git-hooks,
// pre-commit, and anything else that lives in `.git/hooks/`. That's the
// canonical "I'm inside a git hook" signal and dodges the issue #293
// spinner hang for every hook manager at once.
export const NON_INTERACTIVE_ENVIRONMENT_VARIABLES = [
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
  "GIT_DIR",
] as const;

export const isNonInteractiveEnvironment = (): boolean =>
  NON_INTERACTIVE_ENVIRONMENT_VARIABLES.some((envVariable) => Boolean(process.env[envVariable])) ||
  isCodingAgentEnvironment();
