import { RELATED_USE_STATE_THRESHOLD } from "../../constants/thresholds.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
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

const getSetterCallFromStatement = (
  statement: EsTreeNode,
  setterNames: ReadonlySet<string>,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let expression: EsTreeNode | null = null;
  if (isNodeOfType(statement, "ExpressionStatement")) expression = statement.expression;
  else if (isNodeOfType(statement, "ReturnStatement")) expression = statement.argument;
  if (!expression) return null;
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression")) return null;
  if (!isNodeOfType(call.callee, "Identifier")) return null;
  return setterNames.has(call.callee.name) ? call : null;
};

// The shared structural-equality helper deliberately models only
// Identifier / Literal / MemberExpression / CallExpression. Reset
// writes also mirror empty collection initializers (`setTags([])` for
// `useState([])`, `setDraft({})`, `setSeen(new Set())`) and negated
// literals (`setIndex(-1)`), so those shapes are compared here.
const isResetEqualExpression = (
  argument: EsTreeNode | null,
  initializer: EsTreeNode | null,
): boolean => {
  if (!argument || !initializer) return argument === initializer;
  if (isNodeOfType(argument, "ArrayExpression") && isNodeOfType(initializer, "ArrayExpression")) {
    return (argument.elements?.length ?? 0) === 0 && (initializer.elements?.length ?? 0) === 0;
  }
  if (isNodeOfType(argument, "ObjectExpression") && isNodeOfType(initializer, "ObjectExpression")) {
    return (argument.properties?.length ?? 0) === 0 && (initializer.properties?.length ?? 0) === 0;
  }
  if (isNodeOfType(argument, "NewExpression") && isNodeOfType(initializer, "NewExpression")) {
    return (
      (argument.arguments?.length ?? 0) === 0 &&
      (initializer.arguments?.length ?? 0) === 0 &&
      areExpressionsStructurallyEqual(argument.callee, initializer.callee)
    );
  }
  if (isNodeOfType(argument, "UnaryExpression") && isNodeOfType(initializer, "UnaryExpression")) {
    return (
      argument.operator === initializer.operator &&
      isResetEqualExpression(argument.argument, initializer.argument)
    );
  }
  return areExpressionsStructurallyEqual(argument, initializer);
};

// `setQuery("")` where the state was declared `useState("")` writes the
// initial value back — a reset, not a data-carrying transition.
const isResetToInitialWrite = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  initializersBySetterName: ReadonlyMap<string, EsTreeNode | null>,
): boolean => {
  if (!isNodeOfType(setterCall.callee, "Identifier")) return false;
  if (!initializersBySetterName.has(setterCall.callee.name)) return false;
  const initializer = initializersBySetterName.get(setterCall.callee.name) ?? null;
  const setterArgument = (setterCall.arguments?.[0] as EsTreeNode | undefined) ?? null;
  return isResetEqualExpression(setterArgument, initializer);
};

// The co-update signal: distinct setters invoked as sibling statements
// of ONE block inside a nested function (a handler or an effect). Sibling
// statements share an execution path, so the states they write always
// change together — the shape useReducer exists to centralize. Setter
// calls split across `if` branches of a keyboard handler are alternatives,
// not one logical transition, and never end up in the same block.
//
// Blocks where EVERY setter writes its state's initial value back are
// reset handlers (`resetDialogState`, close-dialog effects). Resetting N
// independent states is not evidence they "change together" — the corpus
// shows dialog/manager components get flagged solely on their reset
// block. A block with at least one data-carrying write still counts in
// full (mixed transitions like pointer/drag state machines remain TPs).
const findLargestCoUpdatedSetterGroup = (
  componentBody: EsTreeNodeOfType<"BlockStatement">,
  setterNames: ReadonlySet<string>,
  initializersBySetterName: ReadonlyMap<string, EsTreeNode | null>,
): number => {
  let largestGroupSize = 0;
  const visit = (node: EsTreeNode, isInsideNestedFunction: boolean): void => {
    if (isNodeOfType(node, "BlockStatement") && isInsideNestedFunction) {
      const groupSetterNames = new Set<string>();
      let hasDataCarryingWrite = false;
      for (const statement of node.body ?? []) {
        const setterCall = getSetterCallFromStatement(statement, setterNames);
        if (!setterCall || !isNodeOfType(setterCall.callee, "Identifier")) continue;
        groupSetterNames.add(setterCall.callee.name);
        if (!isResetToInitialWrite(setterCall, initializersBySetterName)) {
          hasDataCarryingWrite = true;
        }
      }
      if (hasDataCarryingWrite) {
        largestGroupSize = Math.max(largestGroupSize, groupSetterNames.size);
      }
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
      const bindings = collectUseStateBindings(body, context.scopes);
      const setterNames = new Set(bindings.map((binding) => binding.setterName));
      if (setterNames.size < RELATED_USE_STATE_THRESHOLD) return;
      const initializersBySetterName = new Map<string, EsTreeNode | null>(
        bindings.map((binding) => {
          const initCall = binding.declarator.init;
          const initializer = isNodeOfType(initCall, "CallExpression")
            ? ((initCall.arguments?.[0] as EsTreeNode | undefined) ?? null)
            : null;
          return [binding.setterName, initializer];
        }),
      );
      const coUpdatedCount = findLargestCoUpdatedSetterGroup(
        body,
        setterNames,
        initializersBySetterName,
      );
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
