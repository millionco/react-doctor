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

const findNode = (root: EsTreeNode, predicate: (node: EsTreeNode) => boolean): EsTreeNode => {
  let result: EsTreeNode | null = null;
  const visit = (node: EsTreeNode): void => {
    if (result) return;
    if (predicate(node)) {
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
  if (!result) throw new Error("fixture has no node matching predicate");
  return result;
};

const isCallTo =
  (name: string) =>
  (node: EsTreeNode): boolean =>
    node.type === "CallExpression" &&
    ((node.callee.type === "Identifier" && node.callee.name === name) ||
      (node.callee.type === "MemberExpression" &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === name));

// Regression: a loop test is re-evaluated on the header every iteration, so
// its side-effecting nodes belong INSIDE the loop, not the pre-header block.
describe("loop test belongs to the loop body", () => {
  it("treats a while-condition call as inside the loop", () => {
    const analysis = analyze("function f(q) { while (q.pop()) { work(); } }");
    const testCall = findNode(analysis.program, isCallTo("pop"));
    expect(analysis.isInsideLoop(testCall)).toBe(true);
  });

  it("treats a do-while condition call as inside the loop", () => {
    const analysis = analyze("function f(q) { do { work(); } while (q.pop()); }");
    const testCall = findNode(analysis.program, isCallTo("pop"));
    expect(analysis.isInsideLoop(testCall)).toBe(true);
  });

  it("treats a for-condition call as inside the loop but the init as outside", () => {
    const analysis = analyze("function f() { for (let i = seed(); more(i); i++) { work(); } }");
    const initCall = findNode(analysis.program, isCallTo("seed"));
    const testCall = findNode(analysis.program, isCallTo("more"));
    expect(analysis.isInsideLoop(initCall)).toBe(false);
    expect(analysis.isInsideLoop(testCall)).toBe(true);
  });
});

// Regression: the for-loop `update` runs after the body on the back-edge, not
// in the header. If it lived on the header it would dominate the body (model
// the first iteration as running `update` before the body), skewing SSA.
describe("for-loop update runs after the body", () => {
  it("does not let the update dominate the body, but keeps it inside the loop", () => {
    const analysis = analyze("function f(n) { for (let i = 0; i < n; step()) { work(i); } }");
    const updateCall = findNode(analysis.program, isCallTo("step"));
    const bodyCall = findNode(analysis.program, isCallTo("work"));
    expect(analysis.dominates(updateCall, bodyCall)).toBe(false);
    expect(analysis.isInsideLoop(updateCall)).toBe(true);
  });

  it("still runs the update on an explicit continue", () => {
    const analysis = analyze(`
      function f(n) {
        for (let i = 0; i < n; step()) {
          if (skip(i)) continue;
          work(i);
        }
      }
    `);
    const continueStatement = findNode(
      analysis.program,
      (node) => node.type === "ContinueStatement",
    );
    const updateCall = findNode(analysis.program, isCallTo("step"));
    expect(analysis.isReachable(continueStatement, updateCall)).toBe(true);
  });
});

// Regression: `continue <label>` must add a back-edge to the labeled loop's
// header. Without it the continue block is an orphan and the body becomes
// unreachable from the continue, diverging from real control flow.
describe("labeled continue re-enters the loop", () => {
  it("adds a back-edge for `continue label` on an outer for-of", () => {
    const analysis = analyze(`
      function f(rows) {
        outer: for (const row of rows) {
          for (const cell of row) {
            if (cell) continue outer;
            visit(cell);
          }
        }
      }
    `);
    const continueStatement = findNode(
      analysis.program,
      (node) => node.type === "ContinueStatement",
    );
    const visitCall = findNode(analysis.program, isCallTo("visit"));
    expect(analysis.isReachable(continueStatement, visitCall)).toBe(true);
  });

  it("adds a back-edge for `continue label` on a labeled while", () => {
    const analysis = analyze(`
      function f(n) {
        loop: while (n > 0) {
          if (skip(n)) {
            n--;
            continue loop;
          }
          handle(n);
          n--;
        }
      }
    `);
    const continueStatement = findNode(
      analysis.program,
      (node) => node.type === "ContinueStatement",
    );
    const handleCall = findNode(analysis.program, isCallTo("handle"));
    expect(analysis.isReachable(continueStatement, handleCall)).toBe(true);
  });
});
