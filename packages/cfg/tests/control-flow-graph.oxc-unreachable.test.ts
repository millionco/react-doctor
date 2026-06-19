import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../src/control-flow-graph.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";

// Control-flow fixtures ported from oxc's `eslint/no-unreachable` test
// suite (crates/oxc_linter/src/rules/eslint/no_unreachable.rs). oxc
// asserts these via the rule; here they exercise `cfg.isUnreachable`
// directly. Every case shares a `x = 2` marker statement so the
// assertion is uniform: in oxc's FAIL cases that statement is
// unreachable, in its PASS cases it is reachable.
//
// Cases where our CFG deliberately diverges from oxc are omitted with a
// note: `var`/function-declaration hoisting (a rule policy, not a CFG
// fact). try/catch/finally normal-completion is now modeled via
// Finalize/Join edges and is covered in control-flow-graph.try-finally.test.ts.

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return { ...analyzeControlFlow(parsed.program), program: parsed.program, errors: parsed.errors };
};

// Find the `x = 2` assignment-expression node shared by every fixture.
const findMarker = (root: EsTreeNode): EsTreeNode | null => {
  let found: EsTreeNode | null = null;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (
      node.type === "AssignmentExpression" &&
      (node as { left: EsTreeNode }).left.type === "Identifier" &&
      (node as { left: { name: string } }).left.name === "x" &&
      (node as { right: EsTreeNode }).right.type === "Literal" &&
      (node as { right: { value: unknown } }).right.value === 2
    ) {
      found = node;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
        }
      } else if (child && typeof child === "object" && "type" in (child as object)) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return found;
};

// oxc FAIL cases: the `x = 2` marker is unreachable.
const UNREACHABLE_FIXTURES: ReadonlyArray<string> = [
  "function foo() { var x = 1; if (x) { return; } else { throw e; } x = 2; }",
  "function foo() { var x = 1; if (x) return; else throw -1; x = 2; }",
  "function foo() { var x = 1; try { return; } finally {} x = 2; }",
  "function foo() { var x = 1; try { } finally { return; } x = 2; }",
  "function foo() { var x = 1; do { return; } while (x); x = 2; }",
  "function foo() { var x = 1; for (;;) { if (x) continue; } x = 2; }",
  // The infinite-loop cases are why we port oxc's loop handling — with
  // no `break`, code after the loop is unreachable:
  "function foo() { var x = 1; while (true) { } x = 2; }",
  "function foo() { var x = 1; do { } while (true); x = 2; }",
];

// oxc PASS cases: the `x = 2` marker is reachable.
const REACHABLE_FIXTURES: ReadonlyArray<string> = [
  "function foo() { var x = 1; if (x) { return; } x = 2; }",
  "function foo() { var x = 1; if (x) { } else { return; } x = 2; }",
  "function foo() { var x = 1; switch (x) { case 0: break; default: return; } x = 2; }",
  "function foo() { var x = 1; while (x) { return; } x = 2; }",
  "function foo() { var x = 1; for (x in {}) { return; } x = 2; }",
  // Infinite loop, but an explicit `break` lets control reach the marker.
  "function foo() { var x = 1; for (;;) { if (x) break; } x = 2; }",
  "function foo() { var x = 1; for (;x == 1;) { if (x) continue; } x = 2; }",
];

describe("control-flow-graph: oxc no-unreachable fixtures", () => {
  describe("unreachable marker (oxc FAIL cases)", () => {
    for (const fixture of UNREACHABLE_FIXTURES) {
      it(fixture, () => {
        const analysis = analyze(fixture);
        expect(analysis.errors).toEqual([]);
        const marker = findMarker(analysis.program);
        expect(marker).not.toBeNull();
        expect(analysis.isUnreachable(marker!)).toBe(true);
      });
    }
  });

  describe("reachable marker (oxc PASS cases)", () => {
    for (const fixture of REACHABLE_FIXTURES) {
      it(fixture, () => {
        const analysis = analyze(fixture);
        expect(analysis.errors).toEqual([]);
        const marker = findMarker(analysis.program);
        expect(marker).not.toBeNull();
        expect(analysis.isUnreachable(marker!)).toBe(false);
      });
    }
  });
});
