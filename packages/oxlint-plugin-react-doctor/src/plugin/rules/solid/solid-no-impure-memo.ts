import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MEMO_PRIMITIVES: ReadonlyArray<string> = ["createMemo"];

const SIDE_EFFECT_GLOBAL_CALLS = new Set(["fetch", "alert", "confirm", "prompt"]);

const CONSOLE_METHODS = new Set(["log", "warn", "error", "info", "debug"]);
const SUBSCRIPTION_MEMBER_METHODS = new Set([
  "addEventListener",
  "removeEventListener",
  "subscribe",
  "observe",
]);

interface SideEffectInfo {
  description: string;
  node: EsTreeNode;
}

const findSideEffects = (callback: EsTreeNode): SideEffectInfo | null => {
  let result: SideEffectInfo | null = null;
  walkAst(callback, (node) => {
    if (result) return false;
    if (isFunctionLike(node) && node !== callback) return false;

    if (isSetterCall(node)) {
      const callee = (node as EsTreeNodeOfType<"CallExpression">)
        .callee as EsTreeNodeOfType<"Identifier">;
      result = { description: `calls \`${callee.name}()\` (a signal setter)`, node };
      return false;
    }

    if (isNodeOfType(node, "CallExpression")) {
      if (
        isNodeOfType(node.callee, "Identifier") &&
        SIDE_EFFECT_GLOBAL_CALLS.has(node.callee.name)
      ) {
        result = { description: `calls \`${node.callee.name}()\``, node };
        return false;
      }
      if (
        isNodeOfType(node.callee, "MemberExpression") &&
        isNodeOfType(node.callee.property, "Identifier")
      ) {
        const methodName = node.callee.property.name;
        if (
          CONSOLE_METHODS.has(methodName) &&
          isNodeOfType(node.callee.object, "Identifier") &&
          node.callee.object.name === "console"
        ) {
          result = { description: `calls \`console.${methodName}()\``, node };
          return false;
        }
        if (SUBSCRIPTION_MEMBER_METHODS.has(methodName)) {
          result = { description: `calls \`.${methodName}()\``, node };
          return false;
        }
      }
    }

    if (isNodeOfType(node, "AwaitExpression")) {
      result = { description: "contains `await`", node };
      return false;
    }

    if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
      result = { description: "mutates an external object", node };
      return false;
    }
  });
  return result;
};

export const solidNoImpureMemo = defineRule<Rule>({
  id: "solid-no-impure-memo",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "`createMemo` must be a pure derivation — move side effects into `createEffect` instead.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        if (!importTracker.matchImport(MEMO_PRIMITIVES, node.callee.name)) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0];
        if (!isFunctionLike(callback)) return;
        const sideEffect = findSideEffects(callback);
        if (!sideEffect) return;
        context.report({
          node,
          message: `\`createMemo\` should be a pure derivation, but this one ${sideEffect.description}. Move side effects into \`createEffect\`.`,
        });
      },
    };
  },
});
