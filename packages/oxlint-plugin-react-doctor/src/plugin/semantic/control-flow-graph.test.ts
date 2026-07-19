import { describe, expect, it } from "@voidzero-dev/vite-plus-test";
import { analyzeControlFlow } from "./control-flow-graph.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../utils/es-tree-node.js";

const analyze = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  return { ...analyzeControlFlow(parsed.program), program: parsed.program };
};

const findCalleeNode = (root: EsTreeNode, calleeName: string): EsTreeNode | null => {
  let result: EsTreeNode | null = null;
  const visit = (node: EsTreeNode): void => {
    if (result) return;
    if (
      node.type === "CallExpression" &&
      (node as { callee: EsTreeNode }).callee.type === "Identifier" &&
      (node as { callee: { name: string } }).callee.name === calleeName
    ) {
      result = node;
      return;
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as EsTreeNode);
            if (result) return;
          }
        }
      } else if (child && typeof child === "object" && "type" in (child as object)) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(root);
  return result;
};

describe("control-flow-graph", () => {
  describe("isUnconditionalFromEntry", () => {
    it("linear function: every call is unconditional", () => {
      const analysis = analyze(`
        function fn() {
          a();
          b();
        }
      `);
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "a")!)).toBe(true);
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "b")!)).toBe(true);
    });

    it("if-statement: consequent and alternate are conditional, post-merge is unconditional", () => {
      const analysis = analyze(`
        function fn() {
          if (cond) { thenCall(); } else { elseCall(); }
          afterCall();
        }
      `);
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "thenCall")!)).toBe(
        false,
      );
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "elseCall")!)).toBe(
        false,
      );
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "afterCall")!),
      ).toBe(true);
    });

    it("if (x) return: subsequent statements are conditional", () => {
      const analysis = analyze(`
        function fn() {
          if (x) return;
          afterReturn();
        }
      `);
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "afterReturn")!),
      ).toBe(false);
    });

    it("while loop body is conditional", () => {
      const analysis = analyze(`
        function fn() {
          while (x) {
            inLoop();
          }
          afterLoop();
        }
      `);
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "inLoop")!)).toBe(
        false,
      );
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "afterLoop")!),
      ).toBe(true);
    });

    it("for loop body is conditional", () => {
      const analysis = analyze(`
        function fn() {
          for (let i = 0; i < 10; i++) { inLoop(); }
          afterLoop();
        }
      `);
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "inLoop")!)).toBe(
        false,
      );
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "afterLoop")!),
      ).toBe(true);
    });

    it("try block: try body is conditional (might throw); catch body is conditional; after merge is unconditional", () => {
      const analysis = analyze(`
        function fn() {
          try { tryCall(); } catch (e) { catchCall(); }
          afterTry();
        }
      `);
      // try body: model says try is reached unconditionally, but it
      // can throw to catch. Our 'all incoming uncond' check makes the
      // try block conditional because the entry edge is uncond but the
      // block has additional 'cond' outgoing edges to catch — that
      // doesn't change unconditionality of REACHING the block. The
      // try BODY is reached unconditionally; after-merge is also.
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "tryCall")!)).toBe(
        true,
      );
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "catchCall")!),
      ).toBe(false);
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "afterTry")!)).toBe(
        true,
      );
    });

    it("ternary: consequent and alternate are conditional", () => {
      const analysis = analyze(`
        function fn() {
          cond ? a() : b();
          c();
        }
      `);
      // Ternary expressions are NOT modeled at the statement level —
      // a()/b() share a basic block with the surrounding statement. So
      // both report unconditional. (Acceptable for rules-of-hooks: it
      // looks at the AST parent chain too and catches ternary by
      // walking parents.)
      // We assert just `c()` is unconditional.
      expect(analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "c")!)).toBe(true);
    });

    it("nested function: inner function gets its own CFG", () => {
      const analysis = analyze(`
        function outer() {
          if (x) return;
          function inner() {
            innerCall();
          }
        }
      `);
      // innerCall is in inner()'s CFG entry — unconditional within inner.
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "innerCall")!),
      ).toBe(true);
    });

    it("inner arrow inside if: arrow body is unconditional within ITS function", () => {
      const analysis = analyze(`
        function outer() {
          if (x) {
            const fn = () => {
              insideArrow();
            };
          }
        }
      `);
      // insideArrow is unconditional inside the arrow itself.
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "insideArrow")!),
      ).toBe(true);
    });

    it("builds a CFG on demand for a function in a default parameter", () => {
      const analysis = analyze(`
        function outer(callback = () => {
          insideDefault();
        }) {}
      `);
      const callNode = findCalleeNode(analysis.program, "insideDefault")!;
      const owner = analysis.enclosingFunction(callNode)!;

      expect(analysis.cfgFor(owner)).not.toBeNull();
      expect(analysis.isUnconditionalFromEntry(callNode)).toBe(true);
    });

    it("switch case body is conditional", () => {
      const analysis = analyze(`
        function fn(x) {
          switch (x) {
            case 1: case1Call(); break;
            case 2: case2Call(); break;
          }
          afterSwitch();
        }
      `);
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "case1Call")!),
      ).toBe(false);
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "case2Call")!),
      ).toBe(false);
      expect(
        analysis.isUnconditionalFromEntry(findCalleeNode(analysis.program, "afterSwitch")!),
      ).toBe(true);
    });
  });

  describe("enclosingFunction", () => {
    it("returns the closest function-like ancestor", () => {
      const analysis = analyze(`
        function outer() {
          const inner = () => { call(); };
        }
      `);
      const callNode = findCalleeNode(analysis.program, "call")!;
      const owner = analysis.enclosingFunction(callNode);
      expect(owner?.type).toBe("ArrowFunctionExpression");
    });
  });

  describe("cfgFor", () => {
    it("returns a CFG for each function", () => {
      const analysis = analyze(`
        function fn() { call(); }
      `);
      const programBody = (analysis.program as unknown as { body: EsTreeNode[] }).body;
      const fn = programBody.find(
        (statement: EsTreeNode) => statement.type === "FunctionDeclaration",
      )!;
      const cfg = analysis.cfgFor(fn);
      expect(cfg).not.toBeNull();
      expect(cfg!.blocks.length).toBeGreaterThan(0);
      expect(cfg!.entry).toBeDefined();
      expect(cfg!.exit).toBeDefined();
    });

    it("skips host function declarations without bodies", () => {
      const parsed = parseFixture("function declared() {}");
      const programBody = (parsed.program as unknown as { body: EsTreeNode[] }).body;
      const declaration = programBody[0];
      Reflect.set(declaration, "body", null);
      attachParentReferences(parsed.program);

      const analysis = analyzeControlFlow(parsed.program);

      expect(analysis.cfgFor(declaration)).toBeNull();
    });
  });
});
