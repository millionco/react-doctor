import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../src/control-flow-graph.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return { ...analyzeControlFlow(parsed.program), program: parsed.program };
};

const findNodeOfType = (root: EsTreeNode, type: string): EsTreeNode | null => {
  let result: EsTreeNode | null = null;
  const visit = (node: EsTreeNode): void => {
    if (result) return;
    if (node.type === type) {
      result = node;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
          if (result) return;
        }
      } else if (child && typeof child === "object" && "type" in (child as object)) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return result;
};

describe("isInfiniteLoopStart", () => {
  const loopOf = (code: string, type: string) => {
    const analysis = analyze(code);
    const loop = findNodeOfType(analysis.program, type);
    if (!loop) throw new Error(`fixture has no ${type}`);
    return analysis.isInfiniteLoopStart(loop);
  };

  it("flags literal-true loops", () => {
    expect(loopOf("while (true) {}", "WhileStatement")).toBe(true);
    expect(loopOf("while (1) {}", "WhileStatement")).toBe(true);
    expect(loopOf("do {} while (true);", "DoWhileStatement")).toBe(true);
    expect(loopOf("for (;;) {}", "ForStatement")).toBe(true);
  });

  it("folds constant-truthy conditions like oxc", () => {
    expect(loopOf("while (!0) {}", "WhileStatement")).toBe(true);
    expect(loopOf("while (!false) {}", "WhileStatement")).toBe(true);
    expect(loopOf("while (Infinity) {}", "WhileStatement")).toBe(true);
    expect(loopOf("while (`x`) {}", "WhileStatement")).toBe(true);
  });

  it("does not flag loops with a real or falsy exit", () => {
    expect(loopOf("while (x) {}", "WhileStatement")).toBe(false);
    expect(loopOf("while (false) {}", "WhileStatement")).toBe(false);
    expect(loopOf("while (0) {}", "WhileStatement")).toBe(false);
    expect(loopOf("while (!1) {}", "WhileStatement")).toBe(false);
    expect(loopOf("while (``) {}", "WhileStatement")).toBe(false);
    expect(loopOf("for (let i = 0; i < n; i++) {}", "ForStatement")).toBe(false);
  });

  it("is false for non-loop nodes", () => {
    const analysis = analyze("function f() { return 1; }");
    const fn = findNodeOfType(analysis.program, "FunctionDeclaration")!;
    expect(analysis.isInfiniteLoopStart(fn)).toBe(false);
  });

  it("agrees with reachability: code after an infinite loop is dead", () => {
    const analysis = analyze("function f() { while (true) {} after(); }");
    const after = findNodeOfType(analysis.program, "CallExpression")!;
    expect(analysis.isUnreachable(after)).toBe(true);
  });
});

describe("toDot", () => {
  it("renders a function CFG as Graphviz with typed terminals + edge kinds", () => {
    const analysis = analyze("function f(x) { if (x) { a(); } else { b(); } c(); }");
    const fn = findNodeOfType(analysis.program, "FunctionDeclaration")!;
    const dot = analysis.toDot(fn);
    expect(dot).toMatchInlineSnapshot(`
    	"digraph "cfg" {
    	  node [shape=box fontname=monospace];
    	  b0 [label="#0\\lcondition: Identifier\\l» if → b2 / b4\\l"];
    	  b1 [label="#1\\l» unreachable\\l"];
    	  b2 [label="#2\\lstatement: ExpressionStatement\\l» goto b3 (normal)\\l"];
    	  b3 [label="#3\\lstatement: ExpressionStatement\\limplicit-return: BlockStatement\\l» return\\l"];
    	  b4 [label="#4\\lstatement: ExpressionStatement\\l» goto b3 (normal)\\l"];
    	  b0 -> b2 [label="cond"];
    	  b0 -> b4 [label="cond"];
    	  b2 -> b3 [label="uncond"];
    	  b3 -> b1 [label="uncond"];
    	  b4 -> b3 [label="uncond"];
    	}"
    `);
  });

  it("returns null for a node with no CFG", () => {
    const analysis = analyze("const x = 1;");
    const literal = findNodeOfType(analysis.program, "Literal")!;
    expect(analysis.toDot(literal)).toBeNull();
  });
});
