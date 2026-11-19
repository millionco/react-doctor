import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isGlobalNamespaceUnmodified } from "./is-proven-unmodified-global-namespace-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveReactRefSymbol } from "./react-ref-origin.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const getOnlyCallOfPrivateArrow = (
  arrow: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isNodeOfType(arrow, "ArrowFunctionExpression") || arrow.async) return null;
  const declarator = arrow.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(declarator.parent.parent, "Program")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(declarator.id);
  const reference = symbol?.references[0];
  const call = reference?.identifier.parent;
  return symbol?.references.length === 1 &&
    reference?.flag === "read" &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.callee === reference.identifier
    ? call
    : null;
};

const getOnlyObjectArgumentValue = (
  call: EsTreeNodeOfType<"CallExpression">,
  name: string,
): EsTreeNode | null => {
  const [argument] = call.arguments;
  if (call.arguments.length !== 1 || !isNodeOfType(argument, "ObjectExpression")) {
    return null;
  }
  let value: EsTreeNode | null = null;
  for (const property of argument.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    ) {
      return null;
    }
    const key = getStaticPropertyKeyName(property);
    if (key === null || key === "__proto__") return null;
    if (key !== name) continue;
    if (value) return null;
    value = property.value;
  }
  return value;
};

export const isClosedHookRefWriterParameter = (
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(callee, "Identifier")) return false;
  const parameter = scopes.symbolFor(callee);
  if (parameter?.kind !== "parameter") return false;
  const parameterProperty = parameter.bindingIdentifier.parent;
  const hook = parameter.scope.node;
  if (
    !isNodeOfType(parameterProperty, "Property") ||
    parameterProperty.value !== parameter.bindingIdentifier ||
    parameterProperty.computed ||
    !isNodeOfType(hook, "ArrowFunctionExpression") ||
    hook.params[0] !== parameterProperty.parent ||
    !parameter.references.every((reference) => reference.flag === "read")
  ) {
    return false;
  }
  const name = getStaticPropertyKeyName(parameterProperty);
  const hookCall = getOnlyCallOfPrivateArrow(hook, scopes);
  const argument = name && hookCall ? getOnlyObjectArgumentValue(hookCall, name) : null;
  if (!isNodeOfType(argument, "Identifier")) return false;
  const binding = scopes.symbolFor(argument);
  const tupleBinding = binding?.declarationNode;
  if (
    binding?.kind !== "const" ||
    binding.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(tupleBinding, "VariableDeclarator") ||
    !isNodeOfType(tupleBinding.id, "ArrayPattern") ||
    tupleBinding.id.elements.some(
      (element) => element !== null && !isNodeOfType(element, "Identifier"),
    ) ||
    !isNodeOfType(tupleBinding.init, "CallExpression") ||
    tupleBinding.init.arguments.length !== 0 ||
    !isNodeOfType(tupleBinding.init.callee, "Identifier")
  ) {
    return false;
  }
  const receiverBindings = tupleBinding.id.elements;
  const bindingIndex = receiverBindings.findIndex(
    (element) => element === binding.bindingIdentifier,
  );
  if (bindingIndex < 0) return false;
  const provider = scopes.symbolFor(tupleBinding.init.callee);
  const providerInitializer = provider && getDirectConstInitializer(provider);
  if (
    !isNodeOfType(providerInitializer, "ArrowFunctionExpression") ||
    getOnlyCallOfPrivateArrow(providerInitializer, scopes) !== tupleBinding.init ||
    !isNodeOfType(providerInitializer.body, "BlockStatement")
  ) {
    return false;
  }
  const statements = providerInitializer.body.body;
  const returnStatement = statements.at(-1);
  if (
    !statements
      .slice(0, -1)
      .every(
        (statement) => isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const",
      ) ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !isNodeOfType(returnStatement.argument, "ArrayExpression") ||
    returnStatement.argument.elements.some((element) => isNodeOfType(element, "SpreadElement"))
  ) {
    return false;
  }
  const returnedTuple = returnStatement.argument;
  const returnedCallback = returnedTuple.elements[bindingIndex];
  if (!isNodeOfType(returnedCallback, "Identifier")) return false;
  const callbackBinding = scopes.symbolFor(returnedCallback);
  const callbackInitializer = callbackBinding && getDirectConstInitializer(callbackBinding);
  if (
    callbackBinding?.scope.node !== providerInitializer ||
    callbackBinding.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(callbackInitializer, "CallExpression") ||
    !isReactApiCall(callbackInitializer, "useCallback", scopes)
  ) {
    return false;
  }
  const [callback] = callbackInitializer.arguments;
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return false;
  const [callbackParameter] = callback.params;
  const statement =
    isNodeOfType(callback.body, "BlockStatement") && callback.body.body.length === 1
      ? callback.body.body[0]
      : null;
  const assignment = stripParenExpression(
    isNodeOfType(statement, "ExpressionStatement") ? statement.expression : callback.body,
  );
  if (
    callback.params.length !== 1 ||
    !isNodeOfType(callbackParameter, "Identifier") ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.right, "Identifier") ||
    scopes.symbolFor(assignment.right)?.bindingIdentifier !== callbackParameter
  ) {
    return false;
  }
  const ref = resolveReactRefSymbol(assignment.left, scopes);
  const refInitializer = ref && getDirectConstInitializer(ref);
  if (
    ref?.scope.node !== providerInitializer ||
    !isNodeOfType(refInitializer, "CallExpression") ||
    !isReactApiCall(refInitializer, "useRef", scopes)
  ) {
    return false;
  }
  if (
    someAst(
      scopes.rootScope.node,
      (node) =>
        isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node),
    ) ||
    !isGlobalNamespaceUnmodified("Array", scopes)
  ) {
    return false;
  }
  return ref.references.every((reference) => {
    if (reference.flag !== "read") return false;
    const node = reference.identifier;
    const parent = node.parent;
    if (isNodeOfType(parent, "MemberExpression")) {
      return (
        parent.object === node &&
        getStaticPropertyName(parent) === "current" &&
        (parent === assignment.left || !isWithinAssignmentTarget(parent))
      );
    }
    if (parent === returnedTuple) {
      const refIndex = returnedTuple.elements.findIndex((element) => element === node);
      return refIndex >= 0 && !receiverBindings[refIndex];
    }
    return (
      isNodeOfType(parent, "ArrayExpression") &&
      isNodeOfType(parent.parent, "CallExpression") &&
      parent.parent.arguments[1] === parent &&
      isReactApiCall(parent.parent, "useCallback", scopes)
    );
  });
};
