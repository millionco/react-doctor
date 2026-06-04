import * as Effect from "effect/Effect";
import { isCiEnvironment } from "./is-ci-environment.js";
import { isGitHookEnvironment } from "./is-git-hook-environment.js";

// Each scan-report section waits this long before printing, so a first human
// run reads as a guided reveal rather than one painted frame.
export const ONBOARDING_SECTION_DELAY_MS = 850;

// Internal escape hatch: force the first-run onboarding on any run, bypassing
// the onboarded marker, the TTY check, and CI/agent detection. For demos.
export const FORCE_ONBOARDING_ENV_VAR = "REACT_DOCTOR_FORCE_ONBOARDING";

const FALSY_FLAG_VALUES = new Set(["", "0", "false"]);

export const isOnboardingForced = (environment: NodeJS.ProcessEnv = process.env): boolean => {
  const value = environment[FORCE_ONBOARDING_ENV_VAR];
  return value !== undefined && !FALSY_FLAG_VALUES.has(value.toLowerCase());
};

// The beat to `yield*` before a section: a sleep when pacing, else a no-op.
export const onboardingSectionPause = (shouldPace: boolean): Effect.Effect<void> =>
  shouldPace ? Effect.sleep(ONBOARDING_SECTION_DELAY_MS) : Effect.void;

export interface OnboardingRecordInput {
  // Section pacing was enabled for this run (so the reveal actually showed).
  readonly paceOnboardingSections: boolean;
  // The run forces onboarding for a demo (replayable; never consumes the marker).
  readonly forceOnboarding: boolean;
  // The run is `--verbose` (a static review, no onboarding reveal).
  readonly verbose: boolean;
  // The run is non-interactive (CI, git hook, agent); defensive double-check
  // since pacing already requires an interactive stream.
  readonly isNonInteractiveEnvironment: boolean;
}

// Whether a completed render should burn the first-run onboarding marker: only
// when the interactive onboarding reveal actually ran. A forced demo replays
// every time and never consumes the marker; verbose shows no reveal.
export const shouldRecordOnboarding = (input: OnboardingRecordInput): boolean =>
  input.paceOnboardingSections &&
  !input.forceOnboarding &&
  !input.verbose &&
  !input.isNonInteractiveEnvironment;

// Whether the report animations can drive the stream. We deliberately do NOT
// exclude coding-agent shells (e.g. Cursor's integrated terminal) the way
// `isSpinnerInteractive` does: when an agent *captures* output it gets a non-TTY
// pipe, which the `isTTY` check already rejects, so only a human watching a real
// terminal reaches the animated path. Git hooks DO stay excluded: a hook
// inherits the parent TTY (so `isTTY` passes) but must never emit cursor escapes
// (issue #293), and git-hook runs keep the classic layout. CI stays excluded too
// (its logs shouldn't carry cursor escapes); a forced demo overrides all of it.
export const canAnimateOnboarding = (stream: NodeJS.WriteStream = process.stdout): boolean => {
  const isRealTty =
    stream.isTTY === true && (stream.columns ?? 0) > 0 && process.env.TERM !== "dumb";
  if (!isRealTty) return false;
  if (isOnboardingForced()) return true;
  return !isGitHookEnvironment() && !isCiEnvironment();
};
