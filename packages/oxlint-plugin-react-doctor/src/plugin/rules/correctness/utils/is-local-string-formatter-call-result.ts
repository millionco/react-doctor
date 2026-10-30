import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { LOCAL_FORMATTER_ARGUMENT_COUNT } from "./constants.js";

import { isConstructivelyStringExpression } from "./is-constructively-string-expression.js";

const dynamicBindingAccessByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

export const isLocalStringFormatterCallResult = (
  initializer: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !initializer ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== LOCAL_FORMATTER_ARGUMENT_COUNT ||
    initializer.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !isNodeOfType(initializer.callee, "Identifier")
  )
    return false;
  const formatterSymbol = scopes.symbolFor(initializer.callee);
  if (
    !formatterSymbol ||
    formatterSymbol.scope.symbols.some(
      (otherSymbol) => otherSymbol !== formatterSymbol && otherSymbol.name === formatterSymbol.name,
    )
  )
    return false;
  const formatter =
    formatterSymbol.kind === "function"
      ? formatterSymbol.declarationNode
      : getDirectConstInitializer(formatterSymbol);
  if (
    !isFunctionLike(formatter) ||
    formatter.async ||
    formatter.generator ||
    (isNodeOfType(formatter, "FunctionExpression") && Boolean(formatter.id)) ||
    !formatter.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  )
    return false;
  if (
    scopes
      .ownScopeFor(formatter)
      ?.symbols.some(
        (innerSymbol) =>
          innerSymbol.declarationNode === formatter &&
          innerSymbol.references.some(
            (reference) => !isTypeScriptTypePosition(reference.identifier),
          ),
      )
  )
    return false;
  const declaration = formatterSymbol.declarationNode;
  const owner = isNodeOfType(declaration, "VariableDeclarator") ? declaration.parent : declaration;
  if (
    isNodeOfType(owner?.parent, "ExportNamedDeclaration") ||
    isNodeOfType(owner?.parent, "ExportDefaultDeclaration")
  )
    return false;
  if (
    !formatterSymbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const target = findTransparentExpressionRoot(reference.identifier);
      return (
        reference.flag === "read" &&
        (reference.identifier.range[0] < formatter.range[0] ||
          reference.identifier.range[0] > formatter.range[1]) &&
        !isWithinAssignmentTarget(reference.identifier) &&
        isNodeOfType(target.parent, "CallExpression") &&
        target.parent.callee === target &&
        !target.parent.optional
      );
    })
  )
    return false;
  let hasDynamicBindingAccess = dynamicBindingAccessByAnalysis.get(scopes);
  if (hasDynamicBindingAccess === undefined) {
    hasDynamicBindingAccess = false;
    walkAst(scopes.rootScope.node, (node) => {
      if (isTypeScriptTypePosition(node)) return false;
      if (
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
      ) {
        hasDynamicBindingAccess = true;
      }
    });
    dynamicBindingAccessByAnalysis.set(scopes, hasDynamicBindingAccess);
  }
  if (hasDynamicBindingAccess) return false;
  if (!isNodeOfType(formatter.body, "BlockStatement"))
    return isConstructivelyStringExpression(formatter.body);
  const returns = collectFunctionReturnStatements(formatter);
  return (
    returns.some(
      (statement) => statement.argument && isConstructivelyStringExpression(statement.argument),
    ) &&
    returns.every(
      (statement) =>
        !statement.argument ||
        isConstructivelyStringExpression(statement.argument) ||
        (isNodeOfType(statement.argument, "Identifier") &&
          statement.argument.name === "undefined" &&
          scopes.isGlobalReference(statement.argument)),
    )
  );
};
