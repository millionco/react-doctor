import { describe, expect, it } from "vitest";
import { shouldAutoSelectCurrentChoice } from "../src/utils/should-auto-select-current-choice.js";

describe("shouldAutoSelectCurrentChoice", () => {
  it("returns true when nothing is selected and cursor is on an enabled choice", () => {
    const result = shouldAutoSelectCurrentChoice(
      [{ selected: false }, { selected: false }, { selected: false }],
      1,
    );

    expect(result).toBe(true);
  });

  it("returns false when a choice is already selected", () => {
    const result = shouldAutoSelectCurrentChoice(
      [{ selected: true }, { selected: false }, { selected: false }],
      1,
    );

    expect(result).toBe(false);
  });

  it("returns false when cursor is on a disabled choice", () => {
    const result = shouldAutoSelectCurrentChoice(
      [{ selected: false }, { selected: false, disabled: true }],
      1,
    );

    expect(result).toBe(false);
  });

  it("returns false when all choices are disabled and nothing is selected", () => {
    const result = shouldAutoSelectCurrentChoice([{ disabled: true }, { disabled: true }], 0);

    expect(result).toBe(false);
  });

  it("returns false when cursor is out of bounds", () => {
    const result = shouldAutoSelectCurrentChoice([{ selected: false }, { selected: false }], 5);

    expect(result).toBe(false);
  });

  it("returns false when choice states array is empty", () => {
    const result = shouldAutoSelectCurrentChoice([], 0);

    expect(result).toBe(false);
  });

  it("returns true when selected is undefined on all choices", () => {
    const result = shouldAutoSelectCurrentChoice([{}, {}, {}], 0);

    expect(result).toBe(true);
  });

  it("returns false when cursor is negative", () => {
    const result = shouldAutoSelectCurrentChoice([{ selected: false }, { selected: false }], -1);

    expect(result).toBe(false);
  });
});
