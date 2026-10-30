import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactForwardedRefParameter } from "./is-react-forwarded-ref-parameter.js";
import { walkAst } from "./walk-ast.js";

describe("forwarded ref parameter writes", () => {
  it.each([
    ["", true],
    ["ref.current = handle;", true],
    ["(ref as Holder).current = handle;", true],
    ["const snapshot = ref.current;", true],
    ["ref = onChange;", false],
    ["[ref] = [onChange];", false],
    ["({ ref } = callbacks);", false],
    ["({ callback: ref } = callbacks);", false],
    ["[ref = onChange] = callbacks;", false],
    ["({ callback: ref = onChange } = callbacks);", false],
    ["[...ref] = callbacks;", false],
    ["({ ...ref } = callbacks);", false],
    ["for ([ref] of callbacks) {}", false],
    ["for ({ callback: ref } of callbacks) {}", false],
    ["(ref as Callback) = onChange;", false],
    ["const replace = () => { [ref] = callbacks; };", false],
  ])("checks assignment target %s", (setup, expected) => {
    const parsed = parseFixture(`
      import { forwardRef } from "react";
      const Widget = forwardRef((props, ref) => {
        ${setup}
        ref(handle);
      });
    `);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const matches: boolean[] = [];
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "ref"
      ) {
        matches.push(isReactForwardedRefParameter(node.callee, scopes));
      }
    });
    expect(matches).toEqual([expected]);
  });
});
