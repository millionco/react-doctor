import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const EFFECT_PRIMITIVES: ReadonlyArray<string> = ["createEffect", "createRenderEffect"];

const isSetterCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  return /^set[A-Z]/.test(node.callee.name);
};

const bodyIsOnlySetter = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  if (isNodeOfType(callback.body, "BlockStatement")) {
    const statements = callback.body.body;
    if (statements.length !== 1) return false;
    const onlyStatement = statements[0];
    if (isNodeOfType(onlyStatement, "ExpressionStatement")) {
      return isSetterCall(onlyStatement.expression as EsTreeNode);
    }
    return false;
  }
  return isSetterCall(callback.body as EsTreeNode);
};

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

const bodyContainsSideEffects = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  let foundSideEffect = false;
  walkAst(callback.body as EsTreeNode, (node) => {
    if (foundSideEffect) return false;
    if (isFunctionLike(node) && node !== callback) return false;
    if (isNodeOfType(node, "CallExpression")) {
      if (isSetterCall(node)) return;
      if (isNodeOfType(node.callee, "MemberExpression")) {
        const property = node.callee.property;
        if (isNodeOfType(property, "Identifier")) {
          const methodName = property.name;
          if (["log", "warn", "error", "info", "debug", "fetch"].includes(methodName)) {
            foundSideEffect = true;
            return false;
          }
        }
      }
      if (isNodeOfType(node.callee, "Identifier")) {
        const calleeName = node.callee.name;
        if (["fetch", "alert", "confirm", "prompt"].includes(calleeName)) {
          foundSideEffect = true;
          return false;
        }
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
        if (bodyIsOnlySetter(callback)) {
          context.report({
            node,
            message: `This \`${matchedImport}\` only sets derived state — replace with a derived signal (\`const x = () => expr\`) or \`createMemo\`.`,
          });
          return;
        }
        if (bodyContainsOnlySetters(callback) && !bodyContainsSideEffects(callback)) {
          context.report({
            node,
            message: `This \`${matchedImport}\` only sets derived state — replace with \`createMemo\` or derived signals.`,
          });
        }
      },
    };
  },
});
