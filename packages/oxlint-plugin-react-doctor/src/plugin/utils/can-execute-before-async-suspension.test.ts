import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { canExecuteBeforeAsyncSuspension } from "./can-execute-before-async-suspension.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { Rule } from "./rule.js";
import { walkAst } from "./walk-ast.js";

describe("canExecuteBeforeAsyncSuspension", () => {
  it.each([false, true])(
    "keeps default and custom suspensions separate afterAwait=%s",
    (afterAwait) => {
      let checkedCalls = 0;
      const rule: Rule = {
        id: "suspension-cache-control",
        severity: "error",
        create: (context) => ({
          CallExpression: (node) => {
            if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "target") return;
            const owner = findEnclosingFunction(node);
            if (!owner) throw new Error("Expected an enclosing async function");
            const customSuspensions = new Set<EsTreeNode>();
            expect(canExecuteBeforeAsyncSuspension(node, owner, context)).toBe(!afterAwait);
            expect(
              canExecuteBeforeAsyncSuspension(node, owner, context, {
                suspensionNodes: customSuspensions,
              }),
            ).toBe(true);
            walkAst(owner, (candidate) => {
              if (isNodeOfType(candidate, "AwaitExpression")) customSuspensions.add(candidate);
            });
            expect(
              canExecuteBeforeAsyncSuspension(node, owner, context, {
                suspensionNodes: customSuspensions,
              }),
            ).toBe(!afterAwait);
            expect(canExecuteBeforeAsyncSuspension(node, owner, context)).toBe(!afterAwait);
            checkedCalls += 1;
          },
        }),
      };
      const body = afterAwait ? "await source(); target();" : "target(); await source();";
      const result = runRule(rule, `async function task() { ${body} }`);
      expect(result.parseErrors).toEqual([]);
      expect(checkedCalls).toBe(1);
    },
  );
});
