import { describe, expect, it } from "vitest";
import { indentMultilineText } from "../src/utils/indent-multiline-text.js";

describe("indentMultilineText", () => {
  it("adds the prefix to a single line", () => {
    const indentedText = indentMultilineText("Error: Something happened", "    ");

    expect(indentedText).toBe("    Error: Something happened");
  });

  it("adds the prefix to every line in multiline text", () => {
    const explanation =
      "Error: Calling setState synchronously within an effect can trigger cascading renders\n\nEffects are intended to synchronize state between React and external systems.\n* Update external systems with the latest state from React.\n* Subscribe for updates from external systems and set state in a callback.";

    const indentedText = indentMultilineText(explanation, "    ");

    expect(indentedText).toBe(
      "    Error: Calling setState synchronously within an effect can trigger cascading renders\n    \n    Effects are intended to synchronize state between React and external systems.\n    * Update external systems with the latest state from React.\n    * Subscribe for updates from external systems and set state in a callback.",
    );
  });
});
