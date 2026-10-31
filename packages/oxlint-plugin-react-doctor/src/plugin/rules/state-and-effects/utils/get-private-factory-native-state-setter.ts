import { UNSUPPORTED_FACTORY_RUNTIME_TYPES } from "./private-factory/constants.js";
import { hasClosedReactFactoryProviders } from "./private-factory/has-closed-react-factory-providers.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const isPlainFactoryArgument = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "Identifier") || isNodeOfType(expression, "Literal")) return true;
  return Boolean(
    isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    !expression.optional &&
    isPlainFactoryArgument(expression.object),
  );
};

const isNonReferencePropertyName = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(
    parent &&
    ((isNodeOfType(parent, "MemberExpression") &&
      parent.property === identifier &&
      !parent.computed) ||
      (isNodeOfType(parent, "Property") &&
        parent.key === identifier &&
        !parent.computed &&
        !parent.shorthand) ||
      ((isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
        parent.key === identifier &&
        !parent.computed)),
  );
};

export const getPrivateFactoryNativeStateSetter = (
  callee: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const parameterSymbol = context.scopes.symbolFor(callee);
  if (parameterSymbol?.kind !== "parameter") return null;
  const factory = findEnclosingFunction(parameterSymbol.bindingIdentifier);
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params[0] !== parameterSymbol.bindingIdentifier ||
    factory.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(factory.parent, "VariableDeclarator") ||
    factory.parent.init !== factory ||
    !isNodeOfType(factory.parent.id, "Identifier")
  )
    return null;
  const factoryDeclarator = factory.parent;
  const declaration = factoryDeclarator.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !isNodeOfType(declaration.parent, "Program")
  )
    return null;
  const factorySymbol = context.scopes.symbolFor(factoryDeclarator.id);
  if (!factorySymbol || getDirectConstInitializer(factorySymbol) !== factory) return null;
  const factoryReferences = factorySymbol.references.filter(
    (reference) => !isTypeScriptTypePosition(reference.identifier),
  );
  const factoryReference = factoryReferences[0];
  if (factoryReferences.length !== 1 || !factoryReference || factoryReference.flag !== "read")
    return null;
  const invocation = factoryReference.identifier.parent;
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.callee !== factoryReference.identifier ||
    isAstDescendant(invocation, factory) ||
    !isNodeReachableWithinFunction(invocation, context) ||
    invocation.arguments.length !== factory.params.length ||
    invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    invocation.arguments.slice(1).some((argument) => !isPlainFactoryArgument(argument))
  )
    return null;
  const actualSetter = invocation.arguments[0];
  if (!isNodeOfType(actualSetter, "Identifier")) return null;
  const nativePair = resolveReactUseStatePair(actualSetter, context.scopes);
  if (
    !nativePair ||
    nativePair.setterSymbol !== context.scopes.symbolFor(actualSetter) ||
    nativePair.setterSymbol.kind !== "const" ||
    nativePair.setterSymbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(nativePair.declarator.init, "CallExpression") ||
    !isReactApiCall(nativePair.declarator.init, "useState", context.scopes, {
      allowGlobalReactNamespace: true,
    })
  )
    return null;
  const program = findProgramRoot(factory);
  if (!program || !hasClosedReactFactoryProviders(program, context)) return null;
  let isClosed = true;
  walkAst(program, (node): boolean | void => {
    if (!isClosed) return false;
    if (UNSUPPORTED_FACTORY_RUNTIME_TYPES.has(node.type)) {
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    )
      return false;
    if (isTypeScriptTypePosition(node)) return;
    if (isNodeOfType(node, "CallExpression")) {
      const invokedExpression = stripParenExpression(node.callee);
      if (isNodeOfType(invokedExpression, "Identifier") && invokedExpression.name === "eval") {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferencePropertyName(node)) return;
    if (node.name === "arguments") {
      isClosed = false;
      return false;
    }
    if (node.name === factorySymbol.name && node !== factorySymbol.bindingIdentifier) {
      const reference = context.scopes.referenceFor(node);
      if (
        !reference ||
        reference.resolvedSymbol !== factorySymbol ||
        reference.flag !== "read" ||
        node !== factoryReference.identifier
      )
        isClosed = false;
    }
    if (
      isAstDescendant(node, factory) &&
      node.name === parameterSymbol.name &&
      node !== parameterSymbol.bindingIdentifier
    ) {
      const reference = context.scopes.referenceFor(node);
      const call = node.parent;
      if (
        !reference ||
        reference.resolvedSymbol !== parameterSymbol ||
        reference.flag !== "read" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== node ||
        call.optional ||
        call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        isClosed = false;
    }
  });
  return isClosed ? nativePair.declarator : null;
};
