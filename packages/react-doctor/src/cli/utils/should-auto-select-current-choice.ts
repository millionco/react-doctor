import type { PromptMultiselectChoiceState } from "@react-doctor/core";

export const shouldAutoSelectCurrentChoice = (
  choiceStates: PromptMultiselectChoiceState[],
  cursor: number,
): boolean => {
  const hasSelection = choiceStates.some((choiceState) => choiceState.selected);
  if (hasSelection) return false;

  const currentChoice = choiceStates[cursor];
  return Boolean(currentChoice) && !currentChoice.disabled;
};
