import type { PromptMultiselectChoiceState } from "@react-doctor/core";

export const shouldSelectAllChoices = (choiceStates: PromptMultiselectChoiceState[]): boolean => {
  return choiceStates.some((choiceState) => !choiceState.disabled && choiceState.selected !== true);
};
