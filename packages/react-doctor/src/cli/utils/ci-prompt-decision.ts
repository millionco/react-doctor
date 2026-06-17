import { createProjectDecisionStore } from "./project-decision-store.js";
import type {
  ProjectDecisionOutcome,
  ProjectDecisionStoreOptions,
} from "./project-decision-store.js";

export type CiPromptDecisionOutcome = ProjectDecisionOutcome;
export type CiPromptDecisionStoreOptions = ProjectDecisionStoreOptions;

// The "Add React Doctor to CI?" pitch is a one-time, per-repo decision, shared
// by `install` onboarding and the post-scan handoff. Either answer suppresses
// future pitches — a decline shouldn't re-nag on every scan, and an accept whose
// workflow write didn't land shouldn't re-pitch either (the user can re-run
// `react-doctor install`).
const store = createProjectDecisionStore("ciPrompts");

export const getCiPromptConfigPath = store.getConfigPath;
// Whether the CI pitch was already answered (accepted OR declined) for this repo.
export const hasHandledCiPrompt = store.hasHandled;
// Records the user's one-time answer for this repo. Returns whether it persisted.
export const recordCiPromptDecision = store.record;
