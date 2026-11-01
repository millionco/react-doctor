import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { jsxCurlyBracePresence } from "./jsx-curly-brace-presence.js";

const sourceForwardedRule: Rule = {
  ...jsxCurlyBracePresence,
  create: (context) => wrapWithSemanticContext(jsxCurlyBracePresence).create(context),
};

describe("JSX comments preserved through semantic contexts", () => {
  it("retains a comment inside an expression container", () => {
    expect(
      runRule(
        sourceForwardedRule,
        "export const Page = () => <div>{/* keep comment */ 'hello'}</div>;",
      ),
    ).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it("reports the same literal without a comment", () => {
    const result = runRule(sourceForwardedRule, "export const Page = () => <div>{'hello'}</div>;");
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
