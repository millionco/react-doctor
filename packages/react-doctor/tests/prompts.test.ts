import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vite-plus/test";
import { prompts } from "../src/utils/prompts.js";

const require = createRequire(import.meta.url);

interface MultiselectChoiceState {
  disabled?: boolean;
  selected?: boolean;
}

interface MultiselectContext {
  bell: () => void;
  cursor: number;
  maxChoices?: number;
  render: () => void;
  value: MultiselectChoiceState[];
}

describe("prompts", () => {
  it("patches multiselect toggleAll to select only enabled choices", async () => {
    await prompts([]);
    const MultiselectPrompt = require("prompts/lib/elements/multiselect");
    const context: MultiselectContext = {
      bell: vi.fn(),
      cursor: 0,
      render: vi.fn(),
      value: [{ selected: false }, { disabled: true, selected: false }, { selected: false }],
    };

    Reflect.apply(MultiselectPrompt.prototype.toggleAll, context, []);

    expect(context.value).toEqual([
      { selected: true },
      { disabled: true, selected: false },
      { selected: true },
    ]);
    expect(context.render).toHaveBeenCalledOnce();
    expect(context.bell).not.toHaveBeenCalled();
  });

  it("rings bell instead of toggling when current choice is disabled", async () => {
    await prompts([]);
    const MultiselectPrompt = require("prompts/lib/elements/multiselect");
    const context: MultiselectContext = {
      bell: vi.fn(),
      cursor: 0,
      render: vi.fn(),
      value: [{ disabled: true, selected: false }, { selected: false }],
    };

    Reflect.apply(MultiselectPrompt.prototype.toggleAll, context, []);

    expect(context.value).toEqual([{ disabled: true, selected: false }, { selected: false }]);
    expect(context.bell).toHaveBeenCalledOnce();
    expect(context.render).not.toHaveBeenCalled();
  });
});
