import { describe, expect, it } from "vitest";
import { shouldSelectAllChoices } from "../src/utils/should-select-all-choices.js";

describe("shouldSelectAllChoices", () => {
  it("returns true when no enabled choice is selected", () => {
    const shouldSelectAllEnabledChoices = shouldSelectAllChoices([
      { selected: false },
      { selected: false },
    ]);

    expect(shouldSelectAllEnabledChoices).toBe(true);
  });

  it("returns true when some enabled choices are selected", () => {
    const shouldSelectAllEnabledChoices = shouldSelectAllChoices([
      { selected: true },
      { selected: false },
      { selected: false },
    ]);

    expect(shouldSelectAllEnabledChoices).toBe(true);
  });

  it("returns false when all enabled choices are selected", () => {
    const shouldSelectAllEnabledChoices = shouldSelectAllChoices([
      { selected: true },
      { selected: true },
      { selected: true },
    ]);

    expect(shouldSelectAllEnabledChoices).toBe(false);
  });

  it("ignores disabled choices when checking if all are selected", () => {
    const shouldSelectAllEnabledChoices = shouldSelectAllChoices([
      { selected: true },
      { selected: false, disabled: true },
      { selected: true },
    ]);

    expect(shouldSelectAllEnabledChoices).toBe(false);
  });
});
