import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REACTIVE_PRIMITIVES: ReadonlyArray<string> = [
  "createEffect",
  "createMemo",
  "createComputed",
  "createRenderEffect",
];

const ASYNC_SCHEDULER_NAMES = new Set(["setTimeout", "setInterval", "requestAnimationFrame"]);

const isZeroArgIdentifierCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.arguments.length === 0;

const containsSignalRead = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (found) return false;
    if (isZeroArgIdentifierCall(child)) {
      found = true;
      return false;
    }
  });
  return found;
};

interface AsyncSignalRead {
  schedulerName: string;
  node: EsTreeNode;
}

const findAsyncSignalReads = (callback: EsTreeNode): ReadonlyArray<AsyncSignalRead> => {
  const results: AsyncSignalRead[] = [];
  walkAst(callback, (node) => {
    if (isFunctionLike(node) && node !== callback) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (!isNodeOfType(node.callee, "Identifier")) return;
    if (!ASYNC_SCHEDULER_NAMES.has(node.callee.name)) return;
    const schedulerName = node.callee.name;
    const firstArgument = node.arguments[0];
    if (!firstArgument || !isFunctionLike(firstArgument)) return;
    if (containsSignalRead(firstArgument)) {
      results.push({ schedulerName, node });
    }
  });
  return results;
};

export const solidNoAsyncTrackedScope = defineRule<Rule>({
  id: "solid-no-async-tracked-scope",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Read signals synchronously before the async boundary — capture the value in a variable, then use it inside the callback.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedImport = importTracker.matchImport(REACTIVE_PRIMITIVES, node.callee.name);
        if (!matchedImport) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0];
        if (!isFunctionLike(callback)) return;
        const asyncSignalReads = findAsyncSignalReads(callback);
        for (const { schedulerName, node: schedulerNode } of asyncSignalReads) {
          context.report({
            node: schedulerNode,
            message: `Signal read inside \`${schedulerName}\` callback within \`${matchedImport}\` — Solid's tracking is synchronous, so this read won't be tracked. Read the signal before the \`${schedulerName}\` call instead.`,
          });
        }
      },
    };
  },
});
