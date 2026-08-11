import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "./get-static-template-literal-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";

const MAX_CONST_RESOLUTION_HOPS = 4;

interface StaticStringWorkItem {
  expression: EsTreeNode;
  remainingConstAliases: number | null;
  resolvingSymbols: Set<SymbolDescriptor>;
}

interface StaticStringResolutionOptions {
  readonly maximumConstAliases?: number | null;
  readonly shouldFoldStaticConditions?: boolean;
  readonly shouldKeepKnownValues?: boolean;
}

const resolveStaticStringExpressionValues = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  options: StaticStringResolutionOptions = {},
): ReadonlyArray<string> | null => {
  const maximumConstAliases =
    options.maximumConstAliases === undefined
      ? MAX_CONST_RESOLUTION_HOPS
      : options.maximumConstAliases;
  const shouldFoldStaticConditions = options.shouldFoldStaticConditions ?? false;
  const shouldKeepKnownValues = options.shouldKeepKnownValues ?? false;
  const staticStringValues: string[] = [];
  const workItems: StaticStringWorkItem[] = [
    {
      expression: rawExpression,
      remainingConstAliases: maximumConstAliases,
      resolvingSymbols: new Set(),
    },
  ];

  while (workItems.length > 0) {
    const workItem = workItems.pop();
    if (!workItem) continue;
    const expression = stripParenExpression(workItem.expression);
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value !== "string") {
        if (shouldKeepKnownValues) continue;
        return null;
      }
      staticStringValues.push(expression.value);
      continue;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      const staticValue = getStaticTemplateLiteralValue(expression);
      if (staticValue === null) {
        if (shouldKeepKnownValues) continue;
        return null;
      }
      staticStringValues.push(staticValue);
      continue;
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      const staticTestValue = shouldFoldStaticConditions
        ? readStaticBoolean(expression.test)
        : null;
      if (staticTestValue !== null) {
        workItems.push({
          expression: staticTestValue ? expression.consequent : expression.alternate,
          remainingConstAliases: workItem.remainingConstAliases,
          resolvingSymbols: workItem.resolvingSymbols,
        });
        continue;
      }
      workItems.push({
        expression: expression.alternate,
        remainingConstAliases: workItem.remainingConstAliases,
        resolvingSymbols: new Set(workItem.resolvingSymbols),
      });
      workItems.push({
        expression: expression.consequent,
        remainingConstAliases: workItem.remainingConstAliases,
        resolvingSymbols: new Set(workItem.resolvingSymbols),
      });
      continue;
    }
    if (
      shouldKeepKnownValues &&
      isNodeOfType(expression, "LogicalExpression") &&
      (expression.operator === "??" || expression.operator === "||")
    ) {
      workItems.push({
        expression: expression.right,
        remainingConstAliases: workItem.remainingConstAliases,
        resolvingSymbols: new Set(workItem.resolvingSymbols),
      });
      workItems.push({
        expression: expression.left,
        remainingConstAliases: workItem.remainingConstAliases,
        resolvingSymbols: new Set(workItem.resolvingSymbols),
      });
      continue;
    }
    if (isNodeOfType(expression, "Identifier")) {
      const symbol = scopes.referenceFor(expression)?.resolvedSymbol;
      if (
        !symbol ||
        symbol.kind !== "const" ||
        !symbol.initializer ||
        !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
        symbol.declarationNode.id !== symbol.bindingIdentifier ||
        workItem.remainingConstAliases === 0 ||
        workItem.resolvingSymbols.has(symbol)
      ) {
        if (shouldKeepKnownValues) continue;
        return null;
      }
      workItem.resolvingSymbols.add(symbol);
      workItems.push({
        expression: symbol.initializer,
        remainingConstAliases:
          workItem.remainingConstAliases === null ? null : workItem.remainingConstAliases - 1,
        resolvingSymbols: workItem.resolvingSymbols,
      });
      continue;
    }
    if (!shouldKeepKnownValues) return null;
  }

  return staticStringValues.length > 0 ? staticStringValues : null;
};

const getStaticStringExpressionValues = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  options: StaticStringResolutionOptions = {},
): ReadonlyArray<string> | null =>
  resolveStaticStringExpressionValues(rawExpression, scopes, options);

export const getKnownStaticStringExpressionValues = (
  rawExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null =>
  resolveStaticStringExpressionValues(rawExpression, scopes, { shouldKeepKnownValues: true });

// Static-resolution big brother of `getJsxPropStringValue`: returns EVERY
// string the attribute can statically evaluate to, or null when any
// possible value is dynamic/unknown. Beyond the plain string literal it
// resolves expression containers holding a string literal, a static
// template literal, a ternary whose branches both resolve (contributing
// both), and an identifier bound by a `const` whose initializer resolves —
// so `role={isChecked ? "checkbox" : "radio"}` and
// `const ROLE = "button"; … role={ROLE}` stop reading as "dynamic, assumed
// valid". Callers decide the aggregation policy: a correctness rule may
// report when ANY candidate is invalid (that branch is a bug when taken),
// a rule whose claim must hold unconditionally should require ALL
// candidates to violate.
const getJsxPropStaticStringValuesWithMode = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
  maximumConstAliases: number | null,
  shouldFoldStaticConditions: boolean,
  shouldKeepKnownValues = false,
): ReadonlyArray<string> | null => {
  const value = attribute.value;
  if (!value) return null;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" ? [value.value] : null;
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    return getStaticStringExpressionValues(value.expression as EsTreeNode, scopes, {
      maximumConstAliases,
      shouldFoldStaticConditions,
      shouldKeepKnownValues,
    });
  }
  return null;
};

export const getJsxPropStaticStringValues = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null =>
  getJsxPropStaticStringValuesWithMode(attribute, scopes, MAX_CONST_RESOLUTION_HOPS, false);

export const getJsxPropExhaustiveStaticStringValues = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null =>
  getJsxPropStaticStringValuesWithMode(attribute, scopes, null, true);

export const getJsxPropKnownStaticStringValues = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null =>
  getJsxPropStaticStringValuesWithMode(attribute, scopes, MAX_CONST_RESOLUTION_HOPS, false, true);
