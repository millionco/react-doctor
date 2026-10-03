import type { PromptMultiselectChoiceState } from "@react-doctor/core";

export const shouldSelectAllChoices = (choiceStates: PromptMultiselectChoiceState[]): boolean =>
  choiceStates.some((choiceState) => !choiceState.disabled && choiceState.selected !== true);
