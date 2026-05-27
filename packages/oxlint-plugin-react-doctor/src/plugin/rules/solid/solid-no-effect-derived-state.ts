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

const EFFECT_PRIMITIVES: ReadonlyArray<string> = ["createEffect", "createRenderEffect"];

const bodyContainsOnlySetters = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  if (isNodeOfType(callback.body, "BlockStatement")) {
    const statements = callback.body.body;
    if (statements.length === 0) return false;
    return statements.every((statement) => {
      if (isNodeOfType(statement, "ExpressionStatement")) {
        return isSetterCall(statement.expression as EsTreeNode);
      }
      return false;
    });
  }
  return isSetterCall(callback.body as EsTreeNode);
};

const SIDE_EFFECT_GLOBAL_CALLS = new Set(["fetch", "alert", "confirm", "prompt"]);
const CONSOLE_METHODS = new Set(["log", "warn", "error", "info", "debug"]);

const bodyContainsSideEffects = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  let foundSideEffect = false;
  const body = callback.body as EsTreeNode;
  walkAst(body, (node) => {
    if (foundSideEffect) return false;
    if (isFunctionLike(node)) return false;
    if (isNodeOfType(node, "CallExpression")) {
      if (isSetterCall(node)) return;
      if (isNodeOfType(node.callee, "MemberExpression")) {
        const property = node.callee.property;
        if (
          isNodeOfType(property, "Identifier") &&
          CONSOLE_METHODS.has(property.name) &&
          isNodeOfType(node.callee.object, "Identifier") &&
          node.callee.object.name === "console"
        ) {
          foundSideEffect = true;
          return false;
        }
      }
      if (
        isNodeOfType(node.callee, "Identifier") &&
        SIDE_EFFECT_GLOBAL_CALLS.has(node.callee.name)
      ) {
        foundSideEffect = true;
        return false;
      }
    }
    if (isNodeOfType(node, "AwaitExpression")) {
      foundSideEffect = true;
      return false;
    }
    if (isNodeOfType(node, "AssignmentExpression")) {
      if (isNodeOfType(node.left, "MemberExpression")) {
        foundSideEffect = true;
        return false;
      }
    }
  });
  return foundSideEffect;
};

export const solidNoEffectDerivedState = defineRule<Rule>({
  id: "solid-no-effect-derived-state",
  severity: "warn",
  requires: ["solid"],
  recommendation:
    "Replace the effect with a derived signal (`const x = () => expr`) or `createMemo(() => expr)` — effects that only set state from reactive values are redundant in Solid.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "Identifier")) return;
        const matchedImport = importTracker.matchImport(EFFECT_PRIMITIVES, node.callee.name);
        if (!matchedImport) return;
        if (node.arguments.length < 1) return;
        const callback = node.arguments[0];
        if (!isFunctionLike(callback)) return;
        if (!bodyContainsOnlySetters(callback)) return;
        if (bodyContainsSideEffects(callback)) return;
        context.report({
          node,
          message: `This \`${matchedImport}\` only sets derived state — replace with a derived signal (\`const x = () => expr\`) or \`createMemo\`.`,
        });
      },
    };
  },
});
