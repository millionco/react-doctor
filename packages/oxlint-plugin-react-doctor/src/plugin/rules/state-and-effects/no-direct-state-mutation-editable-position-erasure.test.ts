import { describe, expect, it } from "vite-plus/test";
import { EDITABLE_POSITION_NOMINAL_SOURCE } from "../../../test-utils/editable-position-proof/constants.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

describe("no-direct-state-mutation editable position erasure", () => {
  it("keeps a state-array mutation visible behind an erased interface", () => {
    const code = EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      "  const focusNext = (position: number) => {\n    interface textValues {}\n    textValues.reverse();\n",
    );
    const result = runRule(noDirectStateMutation, code, {
      filename: "/src/editable-position-state-mutation.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        column: 4,
        line: 24,
        message:
          'React can\'t tell .reverse() changed "textValues" in place, so this update can be skipped or lost.',
        nodeType: "CallExpression",
      },
    ]);
  });
});
