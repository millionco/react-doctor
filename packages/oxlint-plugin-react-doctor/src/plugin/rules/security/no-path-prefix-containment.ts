import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { hasBindingWriteBetween } from "../../utils/has-binding-write-between.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const PATH_MODULES = new Set(["node:path", "path"]);
const PATH_SEPARATORS = new Set(["/", "\\"]);

const resolveStableExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return unwrappedExpression;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return unwrappedExpression;
  const initializer = getDirectUnreassignedInitializer(symbol);
  if (!initializer) return unwrappedExpression;
  visitedSymbolIds.add(symbol.id);
  return resolveStableExpression(initializer, context, visitedSymbolIds);
};

const areSameStableExpressions = (
  firstExpression: EsTreeNode,
  secondExpression: EsTreeNode,
  context: RuleContext,
): boolean =>
  areExpressionsStructurallyEqual(
    resolveStableExpression(firstExpression, context),
    resolveStableExpression(secondExpression, context),
    {
      areIdentifiersEqual: (firstIdentifier, secondIdentifier) => {
        if (
          !isNodeOfType(firstIdentifier, "Identifier") ||
          !isNodeOfType(secondIdentifier, "Identifier")
        ) {
          return false;
        }
        const firstSymbol = context.scopes.symbolFor(firstIdentifier);
        const secondSymbol = context.scopes.symbolFor(secondIdentifier);
        if (firstSymbol || secondSymbol) {
          if (!firstSymbol || firstSymbol !== secondSymbol) return false;
          const earlierIdentifier =
            firstIdentifier.range[0] <= secondIdentifier.range[0]
              ? firstIdentifier
              : secondIdentifier;
          const laterIdentifier =
            earlierIdentifier === firstIdentifier ? secondIdentifier : firstIdentifier;
          return !hasBindingWriteBetween(
            earlierIdentifier,
            earlierIdentifier,
            laterIdentifier,
            context.scopes,
          );
        }
        return (
          firstIdentifier.name === secondIdentifier.name &&
          context.scopes.isGlobalReference(firstIdentifier) &&
          context.scopes.isGlobalReference(secondIdentifier)
        );
      },
    },
  );

const getResolvedPathCall = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const resolvedExpression = resolveStableExpression(expression, context);
  if (!isNodeOfType(resolvedExpression, "CallExpression")) return null;
  const importedApi = resolveImportedApiReference(resolvedExpression.callee, context.scopes);
  if (
    !importedApi ||
    !PATH_MODULES.has(importedApi.source) ||
    importedApi.importedName !== "resolve"
  ) {
    return null;
  }
  return resolvedExpression;
};

const isPathSeparatorExpression = (expression: EsTreeNode, context: RuleContext): boolean => {
  const resolvedExpression = resolveStableExpression(expression, context);
  if (isNodeOfType(resolvedExpression, "Literal") && typeof resolvedExpression.value === "string") {
    return PATH_SEPARATORS.has(resolvedExpression.value);
  }
  const importedApi = resolveImportedApiReference(resolvedExpression, context.scopes);
  return Boolean(
    importedApi && PATH_MODULES.has(importedApi.source) && importedApi.importedName === "sep",
  );
};

const hasPathSeparatorSuffix = (expression: EsTreeNode, context: RuleContext): boolean => {
  const resolvedExpression = resolveStableExpression(expression, context);
  if (isNodeOfType(resolvedExpression, "Literal") && typeof resolvedExpression.value === "string") {
    return [...PATH_SEPARATORS].some((separator) => resolvedExpression.value.endsWith(separator));
  }
  if (isNodeOfType(resolvedExpression, "BinaryExpression")) {
    return (
      resolvedExpression.operator === "+" &&
      isPathSeparatorExpression(resolvedExpression.right, context)
    );
  }
  if (!isNodeOfType(resolvedExpression, "TemplateLiteral")) return false;
  const trailingQuasi = resolvedExpression.quasis.at(-1);
  const trailingText = trailingQuasi?.value.cooked ?? trailingQuasi?.value.raw ?? "";
  if ([...PATH_SEPARATORS].some((separator) => trailingText.endsWith(separator))) return true;
  if (trailingText !== "") return false;
  const trailingExpression = resolvedExpression.expressions.at(-1);
  return Boolean(trailingExpression && isPathSeparatorExpression(trailingExpression, context));
};

const isPathSeparatorSuffixedVersionOf = (
  suffixedExpression: EsTreeNode,
  bareExpression: EsTreeNode,
  context: RuleContext,
): boolean => {
  const resolvedSuffixedExpression = resolveStableExpression(suffixedExpression, context);
  const resolvedBareExpression = resolveStableExpression(bareExpression, context);
  const suffixedStaticValue = getStaticStringExpression(resolvedSuffixedExpression);
  const bareStaticValue = getStaticStringExpression(resolvedBareExpression);
  if (suffixedStaticValue !== null && bareStaticValue !== null) {
    return [...PATH_SEPARATORS].some(
      (separator) => suffixedStaticValue === `${bareStaticValue}${separator}`,
    );
  }
  if (
    isNodeOfType(resolvedSuffixedExpression, "BinaryExpression") &&
    resolvedSuffixedExpression.operator === "+" &&
    isPathSeparatorExpression(resolvedSuffixedExpression.right, context)
  ) {
    return areSameStableExpressions(resolvedSuffixedExpression.left, bareExpression, context);
  }
  if (!isNodeOfType(resolvedSuffixedExpression, "TemplateLiteral")) return false;
  const trailingQuasi = resolvedSuffixedExpression.quasis.at(-1);
  const trailingText = trailingQuasi?.value.cooked ?? trailingQuasi?.value.raw ?? "";
  if (
    resolvedSuffixedExpression.expressions.length === 1 &&
    resolvedSuffixedExpression.quasis.length === 2 &&
    (resolvedSuffixedExpression.quasis[0]?.value.cooked ??
      resolvedSuffixedExpression.quasis[0]?.value.raw ??
      "") === "" &&
    PATH_SEPARATORS.has(trailingText)
  ) {
    const baseExpression = resolvedSuffixedExpression.expressions[0];
    return Boolean(
      baseExpression && areSameStableExpressions(baseExpression, bareExpression, context),
    );
  }
  if (
    resolvedSuffixedExpression.expressions.length !== 2 ||
    resolvedSuffixedExpression.quasis.some(
      (quasi) => (quasi.value.cooked ?? quasi.value.raw ?? "") !== "",
    )
  ) {
    return false;
  }
  const baseExpression = resolvedSuffixedExpression.expressions[0];
  const separatorExpression = resolvedSuffixedExpression.expressions[1];
  return Boolean(
    baseExpression &&
    separatorExpression &&
    isPathSeparatorExpression(separatorExpression, context) &&
    areSameStableExpressions(baseExpression, bareExpression, context),
  );
};

export const noPathPrefixContainment = defineRule({
  id: "no-path-prefix-containment",
  title: "Path containment check uses a string prefix",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `path.relative(root, candidate)` and reject `..` or absolute results instead of comparing path strings with the bare root prefix.",
  create: (context: RuleContext): RuleVisitors => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyName(node.callee) !== "startsWith"
      ) {
        return;
      }
      if (node.arguments.length !== 1) return;
      const prefixExpression = node.arguments?.[0];
      if (!prefixExpression || isNodeOfType(prefixExpression, "SpreadElement")) return;
      if (hasPathSeparatorSuffix(prefixExpression, context)) return;
      const resolvedPathCall = getResolvedPathCall(node.callee.object, context);
      if (!resolvedPathCall || resolvedPathCall.arguments.length < 2) return;
      const rootExpression = resolvedPathCall.arguments[0];
      if (!rootExpression || isNodeOfType(rootExpression, "SpreadElement")) return;
      if (
        !areSameStableExpressions(rootExpression, prefixExpression, context) &&
        !isPathSeparatorSuffixedVersionOf(rootExpression, prefixExpression, context)
      ) {
        return;
      }

      context.report({
        node,
        message:
          "A bare path string prefix also accepts sibling paths such as `<root>-backup`. Use a boundary-aware path containment check.",
      });
    },
  }),
});
