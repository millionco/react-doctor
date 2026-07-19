import { createRequire } from "node:module";
import basePrompts, { type PromptObject, type Answers } from "prompts";
import type { PromptMultiselectContext, PromptSelectContext } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { shouldAutoSelectCurrentChoice } from "./should-auto-select-current-choice.js";
import { shouldSelectAllChoices } from "./should-select-all-choices.js";
import { unrefStdin } from "./unref-stdin.js";

const require = createRequire(import.meta.url);
const PROMPTS_MULTISELECT_MODULE_PATH = "prompts/lib/elements/multiselect";
const PROMPTS_SELECT_MODULE_PATH = "prompts/lib/elements/select";
let didPatchMultiselectToggleAll = false;
let didPatchMultiselectSubmit = false;
let didPatchSelectKeybindSubmit = false;

const onCancel = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(0);
};

export interface CliPromptOptions {
  readonly onCancel?: () => void;
}

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

const patchSelectKeybindSubmit = (): void => {
  if (didPatchSelectKeybindSubmit) return;
  didPatchSelectKeybindSubmit = true;

  const selectPromptConstructor = require(PROMPTS_SELECT_MODULE_PATH);
  const originalInput = selectPromptConstructor.prototype._;

  selectPromptConstructor.prototype._ = function (
    this: PromptSelectContext,
    inputCharacter: string,
    key: unknown,
  ): void {
    if (inputCharacter === " ") {
      originalInput.call(this, inputCharacter, key);
      return;
    }

    const normalizedInput = inputCharacter.toLowerCase();
    const matchingChoiceIndex = this.choices.findIndex(
      (choice) => !choice.disabled && choice.title.toLowerCase().startsWith(normalizedInput),
    );
    if (matchingChoiceIndex < 0) {
      originalInput.call(this, inputCharacter, key);
      return;
    }

    this.moveCursor(matchingChoiceIndex);
    this.submit();
  };
};

export const prompts = <T extends string = string>(
  questions: PromptObject<T> | PromptObject<T>[],
  options: CliPromptOptions = {},
): Promise<Answers<T>> => {
  patchMultiselectToggleAll();
  patchMultiselectSubmit();
  patchSelectKeybindSubmit();
  // HACK: each prompt re-refs stdin and never unrefs it on close, so re-unref
  // once it settles or the one-shot CLI hangs. See `unref-stdin.ts` for why.
  return basePrompts(questions, { onCancel: options.onCancel ?? onCancel }).finally(unrefStdin);
};
