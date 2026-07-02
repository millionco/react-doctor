import { RELATED_USE_STATE_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { collectUseStateBindings } from "./utils/collect-use-state-bindings.js";

const getSetterNameFromStatement = (
  statement: EsTreeNode,
  setterNames: ReadonlySet<string>,
): string | null => {
  let expression: EsTreeNode | null = null;
  if (isNodeOfType(statement, "ExpressionStatement")) expression = statement.expression;
  else if (isNodeOfType(statement, "ReturnStatement")) expression = statement.argument;
  if (!expression) return null;
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression")) return null;
  if (!isNodeOfType(call.callee, "Identifier")) return null;
  return setterNames.has(call.callee.name) ? call.callee.name : null;
};

// The co-update signal: distinct setters invoked as sibling statements
// of ONE block inside a nested function (a handler or an effect). Sibling
// statements share an execution path, so the states they write always
// change together — the shape useReducer exists to centralize. Setter
// calls split across `if` branches of a keyboard handler are alternatives,
// not one logical transition, and never end up in the same block.
const findLargestCoUpdatedSetterGroup = (
  componentBody: EsTreeNodeOfType<"BlockStatement">,
  setterNames: ReadonlySet<string>,
): number => {
  let largestGroupSize = 0;
  const visit = (node: EsTreeNode, isInsideNestedFunction: boolean): void => {
    if (isNodeOfType(node, "BlockStatement") && isInsideNestedFunction) {
      const groupSetterNames = new Set<string>();
      for (const statement of node.body ?? []) {
        const setterName = getSetterNameFromStatement(statement, setterNames);
        if (setterName) groupSetterNames.add(setterName);
      }
      largestGroupSize = Math.max(largestGroupSize, groupSetterNames.size);
    }
    const enteringNestedFunction = isInsideNestedFunction || isFunctionLike(node);
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent" || key === "type") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item)) visit(item, enteringNestedFunction);
        }
      } else if (isAstNode(child)) {
        visit(child, enteringNestedFunction);
      }
    }
  };
  visit(componentBody, false);
  return largestGroupSize;
};

export const preferUseReducer = defineRule({
  id: "prefer-useReducer",
  title: "Many related useState calls",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Group state that always changes together into `useReducer` so one dispatched action describes the whole transition instead of a list of setter calls.",
  create: (context: RuleContext) => {
    const reportCoUpdatedUseState = (body: EsTreeNode, componentName: string): void => {
      if (!isNodeOfType(body, "BlockStatement")) return;
      const setterNames = new Set(
        collectUseStateBindings(body).map((binding) => binding.setterName),
      );
      if (setterNames.size < RELATED_USE_STATE_THRESHOLD) return;
      const coUpdatedCount = findLargestCoUpdatedSetterGroup(body, setterNames);
      if (coUpdatedCount >= RELATED_USE_STATE_THRESHOLD) {
        context.report({
          node: body,
          message: `"${componentName}" updates ${coUpdatedCount} separate useState values in one place — state that changes together is easier to keep consistent as a single useReducer action.`,
        });
      }
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        reportCoUpdatedUseState(node.body, node.id.name);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        reportCoUpdatedUseState(node.init.body, node.id.name);
      },
    };
  },
});
