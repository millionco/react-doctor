import { type CliStateOptions, ONBOARDING_EVENT, getCliStatePath } from "./cli-state-store.js";
import { type Gate, isGatePending, recordGate } from "./cli-lifecycle.js";

// The first-run onboarding reveal, expressed as a global gate: it fires once
// per machine/user. To make the guided reveal re-appear once per repo instead,
// flip `scope` to "project" (and pass `{ projectRoot }` through) — the gate
// machinery supports both with no other change.
export const ONBOARDING_GATE: Gate = { id: ONBOARDING_EVENT, scope: "global" };

export const getOnboardingConfigPath = getCliStatePath;

// `isGatePending` defaults to "not pending" on an unreadable store, so this
// fails safe to "already onboarded" — a broken config dir never replays the
// reveal.
export const hasCompletedOnboarding = (options: CliStateOptions = {}): boolean =>
  !isGatePending(ONBOARDING_GATE, {}, options);

export const markOnboardingComplete = (options: CliStateOptions = {}): void => {
  // Record only on the first reveal so the original timestamp stays stable.
  if (isGatePending(ONBOARDING_GATE, {}, options)) recordGate(ONBOARDING_GATE, {}, options);
};
