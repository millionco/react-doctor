import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCollapsedLiteralOrChainAsValue } from "./no-collapsed-literal-or-chain-as-value.js";

describe("no-collapsed-literal-or-chain-as-value", () => {
  it("flags foo.includes('a' || 'b')", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes("a" || "b");`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags startsWith with a two-literal chain", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `x.startsWith("http://" || "https://");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an equality comparison against a parenthesized literal chain", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `const bad = status === ("open" || "pending");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a numeric literal chain in a !== comparison", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `const bad = code !== (404 || 500);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the ResizeObserver message-filter shape", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `e.message.includes("ResizeObserver loop completed" || "ResizeObserver loop limit");`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags static computed string-search methods", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `message["includes"]("first" || "second"); ("first" || "second")["includes"](message);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a && chain of literals consumed as a value", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes("a" && "b");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template-literal chain with no embedded expressions", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, "foo.includes(`a` || `b`);");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a real default/fallback where an operand is an identifier", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes(x || "default");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when an operand is a member/call expression", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `foo.includes(config.prefix || "https://");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag `value ?? ""` nullish coalescing', () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes(value ?? "");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ternary", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `const y = cond ? "a" : "b"; foo.includes(y);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag string concatenation", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes("a" + "b");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a standalone boolean test outside a consuming context", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `if ("a" || "b") { doThing(); }`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain assigned to a variable then used elsewhere", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `const combined = "a" || "b"; foo.includes(combined);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mixed string/number operands", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes("a" || 1);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-search method call", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.push("a" || "b");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports only once for a three-literal chain", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `foo.includes("a" || "b" || "c");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an all-literal chain as the receiver of a string-search call", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `const isKnownRole = ("admin" || "owner").includes(role);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an all-literal chain used as a switch case test", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `switch (method) { case "GET" || "HEAD": allow(); break; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a switch case fallback where an operand is an identifier", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `switch (method) { case preferredMethod || "GET": allow(); break; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal-chain receiver of a non-search member access", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `const length = ("a" || "b").length;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a literal chain through a TypeScript assertion wrapper", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `const found = text.includes((("a" || "b") as string));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a negative numeric literal chain", () => {
    const result = runRule(noCollapsedLiteralOrChainAsValue, `const bad = code !== (-1 || -2);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a regex literal chain used as a match pattern", () => {
    const result = runRule(
      noCollapsedLiteralOrChainAsValue,
      `const bad = value.match(/first/ || /second/);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
