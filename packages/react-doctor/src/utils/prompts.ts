import { createRequire } from "node:module";
import basePrompts, { type PromptObject, type Answers } from "prompts";
import type { PromptMultiselectContext } from "../types.js";
import { logger } from "./logger.js";
import { shouldAutoSelectCurrentChoice } from "./should-auto-select-current-choice.js";
import { shouldSelectAllChoices } from "./should-select-all-choices.js";

const require = createRequire(import.meta.url);
const PROMPTS_MULTISELECT_MODULE_PATH = "prompts/lib/elements/multiselect";
let didPatchMultiselectToggleAll = false;
let didPatchMultiselectSubmit = false;

const onCancel = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(0);
};

const patchMultiselectToggleAll = (): void => {
  if (didPatchMultiselectToggleAll) return;
  didPatchMultiselectToggleAll = true;

  const multiselectPromptConstructor = require(PROMPTS_MULTISELECT_MODULE_PATH);

  multiselectPromptConstructor.prototype.toggleAll = function (
    this: PromptMultiselectContext,
  ): void {
    const isCurrentChoiceDisabled = Boolean(this.value[this.cursor]?.disabled);
    if (this.maxChoices !== undefined || isCurrentChoiceDisabled) {
      this.bell();
      return;
    }

    const shouldSelectAllEnabledChoices = shouldSelectAllChoices(this.value);

    for (const choiceState of this.value) {
      if (choiceState.disabled) continue;
      choiceState.selected = shouldSelectAllEnabledChoices;
    }

    this.render();
  };
};

const patchMultiselectSubmit = (): void => {
  if (didPatchMultiselectSubmit) return;
  didPatchMultiselectSubmit = true;

  const multiselectPromptConstructor = require(PROMPTS_MULTISELECT_MODULE_PATH);
  const originalSubmit = multiselectPromptConstructor.prototype.submit;

  multiselectPromptConstructor.prototype.submit = function (this: PromptMultiselectContext): void {
    if (shouldAutoSelectCurrentChoice(this.value, this.cursor)) {
      this.value[this.cursor].selected = true;
    }
    originalSubmit.call(this);
  };
};

export const prompts = <T extends string = string>(
  questions: PromptObject<T> | PromptObject<T>[],
): Promise<Answers<T>> => {
  patchMultiselectToggleAll();
  patchMultiselectSubmit();
  return basePrompts(questions, { onCancel });
};
