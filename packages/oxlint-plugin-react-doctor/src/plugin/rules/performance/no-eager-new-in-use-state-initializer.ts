import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const TRIVIAL_EAGER_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Boolean",
  "Number",
  "Object",
  "String",
]);

const CHEAP_VALUE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Date",
  "RegExp",
  "URL",
  "URLSearchParams",
  "Headers",
  "DOMRect",
  "DOMRectReadOnly",
  "DOMPoint",
  "DOMPointReadOnly",
  "DOMMatrix",
  "DOMMatrixReadOnly",
  "DOMQuad",
  "Path2D",
]);

const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set(["globalThis", "self", "window"]);

const isConstantValueExpression = (expression: EsTreeNode): boolean => {
  const pendingExpressions = [expression];
  while (pendingExpressions.length > 0) {
    const nextExpression = pendingExpressions.pop();
    if (!nextExpression) continue;
    const currentExpression = stripParenExpression(nextExpression);
    if (
      isNodeOfType(currentExpression, "Literal") ||
      isNodeOfType(currentExpression, "Identifier")
    ) {
      continue;
    }
    if (isNodeOfType(currentExpression, "TemplateLiteral")) {
      pendingExpressions.push(...currentExpression.expressions);
      continue;
    }
    if (isNodeOfType(currentExpression, "UnaryExpression")) {
      pendingExpressions.push(currentExpression.argument);
      continue;
    }
    if (isNodeOfType(currentExpression, "MemberExpression")) {
      pendingExpressions.push(currentExpression.object);
      if (currentExpression.computed) pendingExpressions.push(currentExpression.property);
      continue;
    }
    if (isNodeOfType(currentExpression, "ArrayExpression")) {
      for (const element of currentExpression.elements) {
        if (!element) continue;
        if (isNodeOfType(element, "SpreadElement")) return false;
        pendingExpressions.push(element);
      }
      continue;
    }
    if (isNodeOfType(currentExpression, "ObjectExpression")) {
      for (const property of currentExpression.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          isNodeOfType(property.value, "FunctionExpression")
        ) {
          return false;
        }
        if (property.computed) pendingExpressions.push(property.key);
        pendingExpressions.push(property.value);
      }
      continue;
    }
    return false;
  }
  return true;
};

const isBoundedConstructorArgument = (argument: EsTreeNode): boolean => {
  const expression = stripParenExpression(argument);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "TemplateLiteral")) return expression.expressions.length === 0;
  if (isNodeOfType(expression, "UnaryExpression")) {
    return isNodeOfType(stripParenExpression(expression.argument), "Literal");
  }
  if (isNodeOfType(expression, "ArrayExpression") || isNodeOfType(expression, "ObjectExpression")) {
    return isConstantValueExpression(expression);
  }
  return false;
};

const getProvenGlobalConstructorName = (
  rawCallee: EsTreeNode,
  context: RuleContext,
): string | null => {
  const visitedSymbolIds = new Set<number>();
  let callee = stripParenExpression(rawCallee);
  while (isNodeOfType(callee, "Identifier")) {
    const symbol = context.scopes.symbolFor(callee);
    if (!symbol) return context.scopes.isGlobalReference(callee) ? callee.name : null;
    if (symbol.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    callee = stripParenExpression(symbol.initializer);
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    GLOBAL_OBJECT_NAMES.has(callee.object.name) &&
    context.scopes.isGlobalReference(callee.object)
  ) {
    return getStaticPropertyName(callee);
  }
  return null;
};

const isExemptNewExpression = (
  newExpression: EsTreeNodeOfType<"NewExpression">,
  context: RuleContext,
): boolean => {
  const constructorName = getProvenGlobalConstructorName(newExpression.callee, context);
  if (!constructorName) return false;
  return (
    (TRIVIAL_EAGER_CONSTRUCTOR_NAMES.has(constructorName) ||
      CHEAP_VALUE_CONSTRUCTOR_NAMES.has(constructorName)) &&
    newExpression.arguments.every(isBoundedConstructorArgument)
  );
};

const findReportableEagerNewExpression = (
  initializer: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"NewExpression"> | null => {
  const pendingExpressions = [initializer];
  while (pendingExpressions.length > 0) {
    const nextExpression = pendingExpressions.pop();
    if (!nextExpression) continue;
    const expression = stripParenExpression(nextExpression);
    if (isNodeOfType(expression, "NewExpression")) {
      if (!isExemptNewExpression(expression, context)) return expression;
      continue;
    }
    if (
      isNodeOfType(expression, "CallExpression") ||
      isNodeOfType(expression, "ArrowFunctionExpression") ||
      isNodeOfType(expression, "FunctionExpression")
    ) {
      continue;
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      pendingExpressions.push(expression.alternate, expression.consequent, expression.test);
      continue;
    }
    if (
      isNodeOfType(expression, "LogicalExpression") ||
      isNodeOfType(expression, "BinaryExpression")
    ) {
      pendingExpressions.push(expression.right, expression.left);
      continue;
    }
    if (isNodeOfType(expression, "SequenceExpression")) {
      pendingExpressions.push(...expression.expressions.toReversed());
      continue;
    }
    if (isNodeOfType(expression, "ArrayExpression")) {
      for (const element of expression.elements.toReversed()) {
        if (!element) continue;
        pendingExpressions.push(
          isNodeOfType(element, "SpreadElement") ? element.argument : element,
        );
      }
      continue;
    }
    if (isNodeOfType(expression, "ObjectExpression")) {
      for (const property of expression.properties.toReversed()) {
        if (isNodeOfType(property, "SpreadElement")) {
          pendingExpressions.push(property.argument);
          continue;
        }
        if (!isNodeOfType(property, "Property")) continue;
        pendingExpressions.push(property.value);
        if (property.computed) pendingExpressions.push(property.key);
      }
      continue;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      pendingExpressions.push(...expression.expressions.toReversed());
      continue;
    }
    if (
      isNodeOfType(expression, "UnaryExpression") ||
      isNodeOfType(expression, "AwaitExpression") ||
      isNodeOfType(expression, "YieldExpression")
    ) {
      if (expression.argument) pendingExpressions.push(expression.argument);
      continue;
    }
    if (isNodeOfType(expression, "MemberExpression")) {
      if (expression.computed) pendingExpressions.push(expression.property);
      pendingExpressions.push(expression.object);
      continue;
    }
    if (isNodeOfType(expression, "AssignmentExpression")) {
      pendingExpressions.push(expression.right, expression.left);
    }
  }
  return null;
};

const getConstructorDescription = (newExpression: EsTreeNodeOfType<"NewExpression">): string => {
  const callee = stripParenExpression(newExpression.callee);
  if (isNodeOfType(callee, "Identifier")) return `new ${callee.name}()`;
  if (isNodeOfType(callee, "MemberExpression")) {
    const propertyName = getStaticPropertyName(callee);
    return propertyName ? `new ${propertyName}()` : "a computed constructor";
  }
  return "a computed constructor";
};

export const noEagerNewInUseStateInitializer = defineRule({
  id: "no-eager-new-in-use-state-initializer",
  title: "Eager constructor in useState initializer",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap nontrivial construction in a function (`useState(() => new X())`) so it only runs on the first render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !node.arguments?.length ||
        !isReactApiCall(node, "useState", context.scopes, {
          allowGlobalReactNamespace: true,
          resolveConditionalAliases: true,
          resolveNamedAliases: true,
        })
      ) {
        return;
      }
      const eagerNewExpression = findReportableEagerNewExpression(node.arguments[0], context);
      if (!eagerNewExpression) return;
      const constructorDescription = getConstructorDescription(eagerNewExpression);
      context.report({
        node: eagerNewExpression,
        message: `${constructorDescription} inside useState constructs a fresh instance on every render and discards it. Wrap the construction in a lazy initializer so it only runs once.`,
      });
    },
  }),
});
