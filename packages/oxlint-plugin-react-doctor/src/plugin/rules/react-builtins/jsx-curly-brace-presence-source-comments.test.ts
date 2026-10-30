import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { jsxCurlyBracePresence } from "./jsx-curly-brace-presence.js";

const cases = [
  {
    code: "<Component name={/* This is a comment */ 'test'} />",
    name: "existing-commented-string-prop",
    expectedCount: 0,
  },
  {
    code: "<Component name={'test'} />",
    name: "same-string-prop-without-comment",
    expectedCount: 1,
  },
];

describe("jsx-curly-brace-presence host source comments", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(wrapWithSemanticContext(jsxCurlyBracePresence), code, {
      filename: "/synthetic/source-comments.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
