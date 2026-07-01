import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noObjectOrArrayCoercedToStringInTemplateLiteral } from "./no-object-or-array-coerced-to-string-in-template-literal.js";

describe("no-object-or-array-coerced-to-string-in-template-literal", () => {
  it("flags interpolating an identifier bound to an object literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const meta = { id: 1 }; return `meta: ${meta}`; }"
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags interpolating an identifier bound to an array literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const sizes = [1, 2, 3]; return `sizes: ${sizes}`; }"
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useRef object interpolated bare", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function C() { const ref = useRef({ x: 0 }); return `ref: ${ref}`; }"
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useState value whose initializer is an array literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function C() { const [items] = useState([]); return `items: ${items}`; }"
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags string + concatenation of an object literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      'function f() { const err = { code: 1 }; return "Error: " + err; }'
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a member access on the interpolated value", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const meta = { id: 1 }; return `meta: ${meta.id}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array joined explicitly", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const sizes = [1, 2, 3]; return `sizes: ${sizes.join(',')}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON.stringify", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const meta = { id: 1 }; return `meta: ${JSON.stringify(meta)}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a function parameter typed as an object", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f(err) { return `Error: ${err}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier bound to a string", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const name = 'ada'; return `name: ${name}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported/unresolved identifier", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { return `value: ${imported}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag numeric + arithmetic (no string sibling)", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const data = [1]; return data + count; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reading a leaf property built into a template", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const source = { slack: { channel: { name: 'x' } } }; return `ch: ${source.slack.channel.name}`; }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
