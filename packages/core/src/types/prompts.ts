export interface PromptMultiselectChoiceState {
  selected?: boolean;
  disabled?: boolean;
}

export interface PromptMultiselectContext {
  maxChoices?: number;
  cursor: number;
  value: PromptMultiselectChoiceState[];
  bell: () => void;
  render: () => void;
}

export interface PromptSelectChoiceState {
  title: string;
  disabled?: boolean;
}

export interface PromptSelectContext {
  choices: PromptSelectChoiceState[];
  cursor: number;
  bell: () => void;
  moveCursor: (cursor: number) => void;
  submit: () => void;
}
