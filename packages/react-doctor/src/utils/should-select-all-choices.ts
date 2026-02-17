import type { PromptMultiselectChoiceState } from "../types.js";

export const shouldSelectAllChoices = (choiceStates: PromptMultiselectChoiceState[]): boolean => {
  const enabledChoiceStates = choiceStates.filter((choiceState) => !choiceState.disabled);
  return enabledChoiceStates.some((choiceState) => choiceState.selected !== true);
};
