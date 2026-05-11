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

  it("rings bell instead of toggling when max choices is set", async () => {
    await prompts([]);
    const MultiselectPrompt = require("prompts/lib/elements/multiselect");
    const context: MultiselectContext = {
      bell: vi.fn(),
      cursor: 0,
      maxChoices: 1,
      render: vi.fn(),
      value: [{ selected: false }, { selected: false }],
    };

    Reflect.apply(MultiselectPrompt.prototype.toggleAll, context, []);

    expect(context.value).toEqual([{ selected: false }, { selected: false }]);
    expect(context.bell).toHaveBeenCalledOnce();
    expect(context.render).not.toHaveBeenCalled();
  });

  it("auto-selects the current choice before submit when it is the only enabled choice", async () => {
    await prompts([]);
    const MultiselectPrompt = require("prompts/lib/elements/multiselect");
    const context = {
      aborted: false,
      close: vi.fn(),
      cursor: 1,
      done: false,
      fire: vi.fn(),
      minSelected: undefined,
      out: { write: vi.fn() },
      render: vi.fn(),
      value: [
        { disabled: true, selected: false },
        { selected: false },
        { disabled: true, selected: false },
      ],
    };

    Reflect.apply(MultiselectPrompt.prototype.submit, context, []);

    expect(context.value[1]?.selected).toBe(true);
    expect(context.done).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
  });
});
