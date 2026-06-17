import { createProjectDecisionStore } from "./project-decision-store.js";

// Answers to the `@v1` -> `@v2` workflow-upgrade offer are terminal per repo.
const store = createProjectDecisionStore("actionUpgrades");

export const getActionUpgradePromptConfigPath = store.getConfigPath;
export const hasHandledActionUpgrade = store.hasHandled;
export const recordActionUpgradeDecision = store.record;
