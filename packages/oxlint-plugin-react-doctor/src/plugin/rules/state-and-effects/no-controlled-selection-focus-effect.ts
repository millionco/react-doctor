import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactEffectHookCall } from "../../utils/is-react-effect-hook-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "This effect focuses an item whenever a controlled selection changes, so an external selection update can steal focus. Gate focus on user navigation or on the list opening.";

const IMPORTED_EFFECT_WRAPPER_NAMES = new Set([
  "useIsomorphicLayoutEffect",
  "useModernLayoutEffect",
]);

const CONTROLLED_SELECTION_NAME_PATTERN = /^(?:selected|selection)(?:index|id|key|item|value)?$/i;

const isRecognizedEffectCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (isReactEffectHookCall(call, context.scopes)) return true;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier") || !IMPORTED_EFFECT_WRAPPER_NAMES.has(callee.name)) {
    return false;
  }
  return context.scopes.symbolFor(callee)?.kind === "import";
};

const getControlledSelectionDependencies = (
  call: EsTreeNodeOfType<"CallExpression">,
  ownerFunction: EsTreeNode,
  context: RuleContext,
): ReadonlySet<number> => {
  const dependencyArgument = call.arguments[1];
  if (!dependencyArgument) return new Set();
  const dependencyArray = stripParenExpression(dependencyArgument);
  if (!isNodeOfType(dependencyArray, "ArrayExpression")) return new Set();
  const selectionSymbolIds = new Set<number>();
  for (const element of dependencyArray.elements) {
    if (!element) continue;
    const dependency = stripParenExpression(element);
    if (
      !isNodeOfType(dependency, "Identifier") ||
      !CONTROLLED_SELECTION_NAME_PATTERN.test(dependency.name)
    ) {
      continue;
    }
    const symbol = context.scopes.symbolFor(dependency);
    if (symbol?.kind === "parameter" && symbol.scope.node === ownerFunction) {
      selectionSymbolIds.add(symbol.id);
    }
  }
  return selectionSymbolIds;
};

const getSelectionRefSymbolId = (
  statement: EsTreeNode,
  selectionSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): number | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  if (!isNodeOfType(expression, "AssignmentExpression") || expression.operator !== "=") {
    return null;
  }
  const target = stripParenExpression(expression.left);
  const selection = stripParenExpression(expression.right);
  if (
    !isNodeOfType(target, "MemberExpression") ||
    getStaticPropertyName(target) !== "current" ||
    !isNodeOfType(selection, "Identifier")
  ) {
    return null;
  }
  const selectionSymbol = context.scopes.symbolFor(selection);
  if (!selectionSymbol || !selectionSymbolIds.has(selectionSymbol.id)) return null;
  const reference = stripParenExpression(target.object);
  if (!isNodeOfType(reference, "Identifier")) return null;
  const referenceSymbol = context.scopes.symbolFor(reference);
  if (!referenceSymbol) return null;
  return referenceSymbol.id;
};

const isFocusCallUsingReference = (
  statement: EsTreeNode,
  referenceSymbolId: number,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const calleeName = getCalleeName(expression);
  if (!calleeName?.startsWith("focus")) return false;
  return expression.arguments.some((argument) => {
    const value = stripParenExpression(argument);
    return (
      isNodeOfType(value, "Identifier") && context.scopes.symbolFor(value)?.id === referenceSymbolId
    );
  });
};

const findControlledSelectionFocus = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const ownerFunction = findEnclosingFunction(call);
  const callback = getEffectCallback(call, context.scopes);
  if (
    !ownerFunction ||
    !isFunctionLike(callback) ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return false;
  }
  const selectionSymbolIds = getControlledSelectionDependencies(call, ownerFunction, context);
  if (selectionSymbolIds.size === 0) return false;
  const selectionRefSymbolIds = new Set<number>();
  for (const statement of callback.body.body) {
    const selectionRefSymbolId = getSelectionRefSymbolId(statement, selectionSymbolIds, context);
    if (selectionRefSymbolId !== null) selectionRefSymbolIds.add(selectionRefSymbolId);
    for (const referenceSymbolId of selectionRefSymbolIds) {
      if (isFocusCallUsingReference(statement, referenceSymbolId, context)) return true;
    }
  }
  return false;
};

export const noControlledSelectionFocusEffect = defineRule({
  id: "no-controlled-selection-focus-effect",
  title: "Controlled selection change steals focus",
  severity: "warn",
  category: "Accessibility",
  tags: ["react-jsx-only"],
  defaultEnabled: false,
  recommendation:
    "Move selection-driven focus into the keyboard or pointer navigation path, or prove that the list just opened before focusing the selected item.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isRecognizedEffectCall(node, context)) return;
      if (findControlledSelectionFocus(node, context)) context.report({ node, message: MESSAGE });
    },
  }),
});
