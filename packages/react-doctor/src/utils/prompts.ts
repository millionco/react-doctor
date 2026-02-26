import { createRequire } from "node:module";
import basePrompts, { type PromptObject, type Answers } from "prompts";
import type { PromptMultiselectContext } from "../types.js";
import { logger } from "./logger.js";
import { shouldAutoSelectCurrentChoice } from "./should-auto-select-current-choice.js";
import { shouldSelectAllChoices } from "./should-select-all-choices.js";

const require = createRequire(import.meta.url);
const PROMPTS_MULTISELECT_MODULE_PATH = "prompts/lib/elements/multiselect";
const PROMPTS_SELECT_MODULE_PATH = "prompts/lib/elements/select";
let didPatchMultiselectToggleAll = false;
let didPatchMultiselectSubmit = false;
let didPatchSelectBanner = false;

const selectBannerMap = new Map<number, string>();

export const setSelectBanner = (banner: string, targetIndex: number): void => {
  selectBannerMap.set(targetIndex, banner);
};

export const clearSelectBanner = (): void => {
  selectBannerMap.clear();
};

const onCancel = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.dim("Run `npx react-doctor@latest --fix` to fix issues.");
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

interface SelectPromptInstance {
  closed: boolean;
  done: boolean;
  cursor: number;
  outputText: string;
  out: { write: (data: string) => boolean; columns: number };
  render: () => void;
}

const patchSelectBanner = (): void => {
  if (didPatchSelectBanner) return;
  didPatchSelectBanner = true;

  const selectConstructor = require(PROMPTS_SELECT_MODULE_PATH);
  const promptsClear = require("prompts/lib/util/clear");
  const originalRender = selectConstructor.prototype.render;

  selectConstructor.prototype.render = function (this: SelectPromptInstance): void {
    originalRender.call(this);

    const banner = selectBannerMap.get(this.cursor);
    if (!banner || this.closed || this.done) {
      return;
    }

    this.out.write(promptsClear(this.outputText, this.out.columns));
    this.outputText = `${banner}\n\n${this.outputText}`;
    this.out.write(this.outputText);
  };
};

export const prompts = <T extends string = string>(
  questions: PromptObject<T> | PromptObject<T>[],
): Promise<Answers<T>> => {
  patchMultiselectToggleAll();
  patchMultiselectSubmit();
  patchSelectBanner();
  return basePrompts(questions, { onCancel });
};
