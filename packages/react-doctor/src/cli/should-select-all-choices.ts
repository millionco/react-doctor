import type { PromptMultiselectChoiceState } from "@react-doctor/types";

export const shouldSelectAllChoices = (choiceStates: PromptMultiselectChoiceState[]): boolean => {
  const enabledChoiceStates = choiceStates.filter((choiceState) => !choiceState.disabled);
  return enabledChoiceStates.some((choiceState) => choiceState.selected !== true);
};
