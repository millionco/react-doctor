import { resolveImportedExportName } from "./find-exported-function-body.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveCrossFileFunctionExport } from "./resolve-cross-file-function-export.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const expressionContainsEventAlias = (
  expression: EsTreeNode,
  identifierNames: ReadonlySet<string>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) return identifierNames.has(candidate.name);
  if (isNodeOfType(candidate, "SpreadElement")) {
    return expressionContainsEventAlias(candidate.argument, identifierNames);
  }
  if (isNodeOfType(candidate, "ObjectExpression")) {
    return candidate.properties.some((property) =>
      isNodeOfType(property, "Property")
        ? expressionContainsEventAlias(property.value, identifierNames)
        : isNodeOfType(property, "SpreadElement") &&
          expressionContainsEventAlias(property.argument, identifierNames),
    );
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.some(
      (element) => element && expressionContainsEventAlias(element, identifierNames),
    );
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      expressionContainsEventAlias(candidate.consequent, identifierNames) ||
      expressionContainsEventAlias(candidate.alternate, identifierNames)
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    return (
      expressionContainsEventAlias(candidate.left, identifierNames) ||
      expressionContainsEventAlias(candidate.right, identifierNames)
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    return candidate.expressions.some((innerExpression) =>
      expressionContainsEventAlias(innerExpression, identifierNames),
    );
  }
  return false;
};

const addAliasNamesFromPattern = (
  pattern: EsTreeNode,
  rawSource: EsTreeNode,
  aliasNames: Set<string>,
): void => {
  const source = stripParenExpression(rawSource);
  if (isNodeOfType(pattern, "Identifier")) {
    if (expressionContainsEventAlias(source, aliasNames)) aliasNames.add(pattern.name);
    return;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    addAliasNamesFromPattern(pattern.left, source, aliasNames);
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern") && isNodeOfType(source, "ObjectExpression")) {
    for (const patternProperty of pattern.properties) {
      if (!isNodeOfType(patternProperty, "Property")) continue;
      const propertyName = getStaticKeyName(patternProperty.key);
      if (!propertyName) continue;
      const sourceProperty = source.properties.find(
        (property) =>
          isNodeOfType(property, "Property") && getStaticKeyName(property.key) === propertyName,
      );
      if (isNodeOfType(sourceProperty, "Property")) {
        addAliasNamesFromPattern(patternProperty.value, sourceProperty.value, aliasNames);
      }
    }
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern") && isNodeOfType(source, "ArrayExpression")) {
    for (const [elementIndex, patternElement] of pattern.elements.entries()) {
      const sourceElement = source.elements[elementIndex];
      if (patternElement && sourceElement) {
        addAliasNamesFromPattern(patternElement, sourceElement, aliasNames);
      }
    }
  }
};

export const isProvenPureImportedPredicateCall = (
  callExpression: EsTreeNode,
  eventArgumentIndex: number,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression") || !context.filename) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  if (!symbol || symbol.kind !== "import") return false;
  const importSpecifier = symbol.declarationNode;
  const importDeclaration = importSpecifier.parent;
  const exportedName = resolveImportedExportName(importSpecifier);
  if (
    !exportedName ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    typeof importDeclaration.source.value !== "string"
  ) {
    return false;
  }
  const importedFunction = resolveCrossFileFunctionExport(
    context.filename,
    importDeclaration.source.value,
    exportedName,
  );
  if (!importedFunction || !isFunctionLike(importedFunction)) return false;
  const parameter = importedFunction.params[eventArgumentIndex];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const aliasNames = new Set([parameter.name]);
  let didFindUnsafeUse = false;
  walkAst(importedFunction.body, (node) => {
    if (didFindUnsafeUse) return false;
    if (isNodeOfType(node, "VariableDeclarator") && node.init) {
      addAliasNamesFromPattern(node.id, node.init, aliasNames);
      return;
    }
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      isNodeOfType(node.left, "Identifier") &&
      expressionContainsEventAlias(node.right, aliasNames)
    ) {
      aliasNames.add(node.left.name);
      return;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const nestedCallee = stripParenExpression(node.callee);
      if (
        (isNodeOfType(nestedCallee, "MemberExpression") &&
          getStaticPropertyName(nestedCallee) === "preventDefault" &&
          expressionContainsEventAlias(nestedCallee.object, aliasNames)) ||
        node.arguments.some(
          (argument) =>
            !isNodeOfType(argument, "SpreadElement") &&
            expressionContainsEventAlias(argument, aliasNames),
        )
      ) {
        didFindUnsafeUse = true;
      }
      return;
    }
    if (
      isNodeOfType(node, "NewExpression") &&
      node.arguments.some(
        (argument) =>
          !isNodeOfType(argument, "SpreadElement") &&
          expressionContainsEventAlias(argument, aliasNames),
      )
    ) {
      didFindUnsafeUse = true;
      return;
    }
    const assignmentTarget = isNodeOfType(node, "AssignmentExpression")
      ? stripParenExpression(node.left)
      : null;
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      ((isNodeOfType(assignmentTarget, "MemberExpression") &&
        expressionContainsEventAlias(assignmentTarget.object, aliasNames)) ||
        expressionContainsEventAlias(node.right, aliasNames))
    ) {
      didFindUnsafeUse = true;
    }
  });
  return !didFindUnsafeUse;
};
