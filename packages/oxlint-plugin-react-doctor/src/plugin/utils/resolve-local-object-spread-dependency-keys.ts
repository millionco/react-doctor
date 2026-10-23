import type { ReferenceDescriptor, ScopeAnalysis } from "../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { hasDynamicScopeAccess } from "./has-dynamic-scope-access.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface LocalObjectSpreadDependencyOptions {
  readonly reference: ReferenceDescriptor;
  readonly scopes: ScopeAnalysis;
  readonly dependencyArray: EsTreeNode | undefined;
}

export const resolveLocalObjectSpreadDependencyKeys = ({
  reference,
  scopes,
  dependencyArray,
}: LocalObjectSpreadDependencyOptions): Set<string> | null => {
  const spreadArgument = findTransparentExpressionRoot(reference.identifier);
  const spread = spreadArgument.parent;
  const symbol = reference.resolvedSymbol;
  const program = scopes.rootScope.node;
  if (
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !isNodeOfType(dependencyArray, "ArrayExpression") ||
    !isNodeOfType(spread, "SpreadElement") ||
    spread.argument !== spreadArgument ||
    !isNodeOfType(spread.parent, "ObjectExpression") ||
    !symbol ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, program, scopes)
  )
    return null;
  const initializer = getDirectConstInitializer(symbol);
  const call = initializer && stripParenExpression(initializer);
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const producerSymbol = scopes.symbolFor(callee);
  const producer = resolveExactLocalFunction(callee, scopes);
  if (
    !producerSymbol ||
    producerSymbol.scope !== scopes.rootScope ||
    hasSymbolBindingWrites(producerSymbol) ||
    !hasCompleteSymbolReferences(producerSymbol, program, scopes) ||
    !isFunctionLike(producer) ||
    producer.async ||
    producer.generator
  )
    return null;
  const declaration = producerSymbol.declarationNode;
  const isPrivateDeclaration =
    isNodeOfType(producer, "FunctionDeclaration") &&
    producer === declaration &&
    producer.parent === program;
  const isPrivateArrow =
    isNodeOfType(producer, "ArrowFunctionExpression") &&
    producer === producerSymbol.initializer &&
    getDirectConstInitializer(producerSymbol) === producer &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.parent === program;
  if (
    (!isPrivateDeclaration && !isPrivateArrow) ||
    !producerSymbol.references.every((usage) => {
      const usageRoot = findTransparentExpressionRoot(usage.identifier);
      const invocation = usageRoot.parent;
      return (
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === usageRoot &&
        !invocation.optional
      );
    })
  )
    return null;
  let returned = producer.body;
  if (isNodeOfType(returned, "BlockStatement")) {
    const [onlyReturn, ...otherReturns] = collectFunctionReturnStatements(producer);
    if (otherReturns.length > 0 || !onlyReturn || returned.body.at(-1) !== onlyReturn) return null;
    if (!onlyReturn.argument) return null;
    returned = onlyReturn.argument;
  }
  const record = stripParenExpression(returned);
  if (!isNodeOfType(record, "ObjectExpression")) return null;
  const propertyNames = new Set<string>();
  for (const property of record.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name === "__proto__" ||
      propertyNames.has(property.key.name)
    )
      return null;
    propertyNames.add(property.key.name);
  }
  if (
    !symbol.references.every((usage) => {
      const usageRoot = findTransparentExpressionRoot(usage.identifier);
      const parent = usageRoot.parent;
      if (
        isNodeOfType(parent, "SpreadElement") &&
        parent.argument === usageRoot &&
        isNodeOfType(parent.parent, "ObjectExpression")
      )
        return true;
      return (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === usageRoot &&
        !parent.optional &&
        !parent.computed &&
        isNodeOfType(parent.property, "Identifier") &&
        propertyNames.has(parent.property.name) &&
        findTransparentExpressionRoot(parent).parent === dependencyArray
      );
    })
  )
    return null;
  return hasDynamicScopeAccess(scopes)
    ? null
    : new Set([...propertyNames].map((propertyName) => `${symbol.name}.${propertyName}`));
};
