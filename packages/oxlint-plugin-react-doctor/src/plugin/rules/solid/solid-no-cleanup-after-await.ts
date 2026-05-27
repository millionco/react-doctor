import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EFFECT_PRIMITIVES: ReadonlyArray<string> = [
  "createEffect",
  "createRenderEffect",
  "createComputed",
  "createResource",
];

const CLEANUP_NAMES: ReadonlyArray<string> = ["onCleanup"];

interface OrderedNode {
  node: EsTreeNode;
  visitOrder: number;
}

const collectAwaitAndCleanupPositions = (
  functionBody: EsTreeNode,
  cleanupLocalNames: ReadonlySet<string>,
): { awaits: ReadonlyArray<OrderedNode>; cleanups: ReadonlyArray<OrderedNode> } => {
  const awaits: OrderedNode[] = [];
  const cleanups: OrderedNode[] = [];
  let visitCounter = 0;

  walkAst(functionBody, (node) => {
    if (isFunctionLike(node) && node !== functionBody) return false;
    const currentOrder = visitCounter++;

    if (isNodeOfType(node, "AwaitExpression")) {
      awaits.push({ node, visitOrder: currentOrder });
    }

    if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "Identifier")) {
      if (cleanupLocalNames.has(node.callee.name)) {
        cleanups.push({ node, visitOrder: currentOrder });
      }
    }
  });

  return { awaits, cleanups };
};

const getCallbackForPrimitive = (
  primitiveName: string,
  callNode: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | undefined => {
  if (primitiveName === "createResource") {
    if (callNode.arguments.length >= 2 && isFunctionLike(callNode.arguments[1])) {
      return callNode.arguments[1];
    }
    if (callNode.arguments.length >= 1 && isFunctionLike(callNode.arguments[0])) {
      return callNode.arguments[0];
    }
    return undefined;
  }
  return callNode.arguments.length >= 1 ? callNode.arguments[0] : undefined;
};

export const solidNoCleanupAfterAwait = defineRule<Rule>({
  id: "solid-no-cleanup-after-await",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Move `onCleanup` before any `await` — after an await the synchronous owner context is lost, so `onCleanup` silently does nothing.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    const cleanupLocalNames = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);

        const source = node.source?.value;
        if (typeof source !== "string" || !/^solid-js/.test(source)) return;

        for (const specifier of node.specifiers) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          const importedIdentifier = specifier.imported;
          if (!isNodeOfType(importedIdentifier, "Identifier")) continue;
          if (CLEANUP_NAMES.includes(importedIdentifier.name)) {
            cleanupLocalNames.add(specifier.local.name);
          }
        }
      },

      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;

        const matchedImport = importTracker.matchImport(EFFECT_PRIMITIVES, node.callee.name);
        if (!matchedImport) return;

        const callback = getCallbackForPrimitive(matchedImport, node);
        if (!callback || !isFunctionLike(callback)) return;
        if (!callback.async) return;

        const { awaits, cleanups } = collectAwaitAndCleanupPositions(callback, cleanupLocalNames);
        if (awaits.length === 0 || cleanups.length === 0) return;

        const earliestAwaitOrder = Math.min(...awaits.map((ordered) => ordered.visitOrder));

        for (const cleanup of cleanups) {
          if (cleanup.visitOrder > earliestAwaitOrder) {
            context.report({
              node: cleanup.node,
              message: `\`onCleanup\` called after \`await\` inside \`${matchedImport}\` — the synchronous owner context is lost after an await, so this cleanup handler will never run. Move it before the first \`await\`.`,
            });
          }
        }
      },
    };
  },
});
