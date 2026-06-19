import { type CliStateOptions, CI_PITCH_EVENT, getCliStatePath } from "./cli-state-store.js";
import { type Gate, isGatePending, recordGate } from "./cli-lifecycle.js";

// The "Add React Doctor to CI?" pitch: a once-per-repo gate shared by `install`
// onboarding and the post-scan handoff. Either answer (accepted OR declined)
// closes the gate, so a decline doesn't re-nag and an accept whose workflow
// write didn't land doesn't re-pitch (the user can re-run `react-doctor
// install`). Bump `version` to re-pitch everyone after a reworked campaign.
export const CI_PITCH_GATE: Gate = { id: CI_PITCH_EVENT, scope: "project" };

export const getCiPromptConfigPath = getCliStatePath;

// Whether the CI pitch was already answered for this repo. Fails safe to
// "handled" on an unreadable store so we never nag where it can't be remembered.
export const hasHandledCiPrompt = (projectRoot: string, options: CliStateOptions = {}): boolean =>
  !isGatePending(CI_PITCH_GATE, { projectRoot }, options);

// Records the user's one-time answer for this repo. Returns whether it persisted.
export const recordCiPromptDecision = (
  projectRoot: string,
  outcome: "accepted" | "declined",
  options: CliStateOptions = {},
): boolean => recordGate(CI_PITCH_GATE, { projectRoot, outcome }, options);
