import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticObjectPropertyValue } from "../../../utils/get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const hasRuntimeImport = (program: EsTreeNode): boolean =>
  isNodeOfType(program, "Program") &&
  program.body.some(
    (statement) => isNodeOfType(statement, "ImportDeclaration") && !isTypeOnlyImport(statement),
  );

const hasDynamicScopeByProgram = new WeakMap<EsTreeNode, boolean>();

const hasDynamicScope = (program: EsTreeNode): boolean => {
  const cached = hasDynamicScopeByProgram.get(program);
  if (cached !== undefined) return cached;
  const detected = someAst(program, (node) => {
    if (!isNodeOfType(node, "CallExpression")) return false;
    const callee = stripParenExpression(node.callee);
    return isNodeOfType(callee, "Identifier") && callee.name === "eval";
  });
  hasDynamicScopeByProgram.set(program, detected);
  return detected;
};

const isPlainParameter = (parameter: EsTreeNode): boolean =>
  isNodeOfType(parameter, "Identifier") ||
  (isNodeOfType(parameter, "ObjectPattern") &&
    parameter.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.value, "Identifier") &&
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== null,
    ));

const getBoundPropertyName = (
  binding: EsTreeNode,
  pattern: EsTreeNode | undefined,
): string | null => {
  const property = binding.parent;
  if (
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isNodeOfType(property, "Property") ||
    property.parent !== pattern ||
    property.value !== binding
  ) {
    return null;
  }
  const name = getStaticPropertyKeyName(property, { allowComputedString: true });
  return name === "__proto__" ? null : name;
};

const isStableValue = (value: EsTreeNode, effect: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(value);
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  if (
    !symbol ||
    (symbol.kind !== "const" && symbol.kind !== "function") ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  if (symbol.scope === scopes.rootScope) return true;

  const owner = findEnclosingFunction(effect);
  const statement = symbol.declarationNode.parent;
  const initializer = symbol.initializer && stripParenExpression(symbol.initializer);
  if (
    !isFunctionLike(owner) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(symbol.declarationNode.id, "Identifier") ||
    statement?.parent !== owner.body ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    !isReactApiCall(initializer, "useCallback", scopes)
  ) {
    return false;
  }
  const specifier = scopes.symbolFor(initializer.callee)?.declarationNode;
  const importDeclaration = specifier?.parent;
  const [callback, dependencies] = initializer.arguments;
  return Boolean(
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    !isTypeOnlyImport(importDeclaration) &&
    initializer.arguments.length === 2 &&
    isFunctionLike(callback) &&
    isNodeOfType(dependencies, "ArrayExpression") &&
    dependencies.elements.length === 0,
  );
};

export const isStableProjectedEffectDependency = (
  dependency: EsTreeNode,
  effect: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(dependency, "Identifier") ||
    !isNodeOfType(effect, "CallExpression") ||
    findTransparentExpressionRoot(dependency).parent !== effect.arguments[1]
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(dependency);
  const declaration = symbol?.declarationNode;
  if (symbol?.kind !== "const" || !isNodeOfType(declaration, "VariableDeclarator")) return false;
  const property = getBoundPropertyName(symbol.bindingIdentifier, declaration.id);
  const call = declaration.init && stripParenExpression(declaration.init);
  if (!property || !isNodeOfType(call, "CallExpression") || call.optional) return false;
  if (!isNodeOfType(call.callee, "Identifier")) return false;

  const factory = resolveExactLocalFunction(call.callee, scopes);
  if (
    !isFunctionLike(factory) ||
    factory.async ||
    factory.generator ||
    !factory.params.every(isPlainParameter) ||
    !hasRuntimeImport(scopes.rootScope.node) ||
    hasDynamicScope(scopes.rootScope.node)
  ) {
    return false;
  }
  const returned = getSingleReturnExpression(factory);
  const selected = returned && getStaticObjectPropertyValue(returned, property);
  if (!selected) return false;
  if (isStableValue(selected, effect, scopes)) return true;
  if (!isNodeOfType(selected, "Identifier") || factory.params.length !== 1) return false;

  const parameter = scopes.symbolFor(selected);
  const [argument] = call.arguments;
  if (
    !parameter ||
    parameter.references.some((reference) => reference.flag !== "read") ||
    !hasCompleteSymbolReferences(parameter, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  const option = getBoundPropertyName(parameter.bindingIdentifier, factory.params[0]);
  if (!option || call.arguments.length !== 1 || !isNodeOfType(argument, "ObjectExpression")) {
    return false;
  }
  const supplied = getStaticObjectPropertyValue(argument, option);
  return Boolean(supplied && isStableValue(supplied, effect, scopes));
};
