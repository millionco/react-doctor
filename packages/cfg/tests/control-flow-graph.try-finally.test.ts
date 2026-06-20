import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../src/control-flow-graph.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import type { EsTreeNode } from "../src/ast/es-tree-node.js";

// try / catch / finally control-flow, ported from oxc's `no-unreachable`,
// `no-unsafe-finally`, and `getter-return` suites. These exercise the
// Finalize / Join edge model: `finally` is reachable on every path (even
// when `try` returns), but code after the try is reachable only when the
// protected region can complete normally.
//
// DELIBERATE DIVERGENCE FROM OXC: for `try { return } catch { return }
// finally { … }`, oxc's builder uses an unconditional tail edge after the
// finally and reports the code after the try as *reachable* (a documented
// over-approximation). We gate the tail on normal completion, so we report
// it unreachable — which matches the real language semantics.

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return { ...analyzeControlFlow(parsed.program), program: parsed.program, errors: parsed.errors };
};

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

// The `x = 2` marker is reachable.
const REACHABLE_FIXTURES: ReadonlyArray<string> = [
  // `finally` runs even though `try` returns — the marker is in the finally body.
  "function foo() { try { return; } finally { x = 2; } }",
  // try completes normally, finally completes normally → after-try reachable.
  "function foo() { try { ok(); } finally { cleanup(); } x = 2; }",
  // try and catch both complete normally → after-try reachable.
  "function foo() { try { mayThrow(); } catch (e) { handle(e); } finally { cleanup(); } x = 2; }",
  // throw is caught and the catch falls through → after-try reachable.
  "function foo() { try { throw e; } catch (err) { b(); } x = 2; }",
  // catch returns, but the try body can still complete normally → reachable.
  "function foo() { try { mayThrow(); } catch (e) { return; } x = 2; }",
];

// The `x = 2` marker is unreachable.
const UNREACHABLE_FIXTURES: ReadonlyArray<string> = [
  // try returns; finally completes normally but resumes the return → after unreachable.
  "function foo() { try { return; } finally { cleanup(); } x = 2; }",
  // finally itself returns → after unreachable.
  "function foo() { try { ok(); } finally { return; } x = 2; }",
  // try and catch both return; no normal path survives → after unreachable.
  "function foo() { try { return; } catch (e) { return; } x = 2; }",
  // try + catch both return, finally normal: precise (oxc over-approximates to reachable).
  "function foo() { try { return; } catch (e) { return; } finally { cleanup(); } x = 2; }",
];

describe("control-flow-graph: try/catch/finally reachability", () => {
  describe("reachable marker", () => {
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

  describe("unreachable marker", () => {
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
});
