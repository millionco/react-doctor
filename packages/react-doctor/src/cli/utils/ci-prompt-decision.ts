import { createProjectDecisionStore } from "./project-decision-store.js";

// Answers to the shared GitHub Actions pitch are terminal per repo across install
// onboarding and the post-scan handoff.
const store = createProjectDecisionStore("ciPrompts");

export const getCiPromptConfigPath = store.getConfigPath;
export const hasHandledCiPrompt = store.hasHandled;
export const recordCiPromptDecision = store.record;
