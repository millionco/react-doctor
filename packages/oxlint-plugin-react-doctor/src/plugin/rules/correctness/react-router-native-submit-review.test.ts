import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { NATIVE_SUBMIT_REVIEW_CASES } from "../../../test-utils/native-submit-review/constants.js";
import { reactRouterNoNavigateInRender } from "./react-router-no-navigate-in-render.js";

describe("closed native submit provider and runtime bindings", () => {
  it.each(NATIVE_SUBMIT_REVIEW_CASES)("$name", ({ name, code, expected }) => {
    const result = runRule(reactRouterNoNavigateInRender, code, {
      filename: `src/native-submit/${name}.tsx`,
      includeLocations: true,
      settings: {
        "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react-router"] },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
