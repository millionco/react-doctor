import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { areNodesInMutuallyExclusiveBranches } from "./are-nodes-in-mutually-exclusive-branches.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { hasClosedReactStateProvider } from "./has-closed-react-state-provider.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const isPrimitiveLiteral = (expression: EsTreeNode | undefined): boolean =>
  isNodeOfType(expression, "Literal") &&
  (expression.value === null || typeof expression.value !== "object");

const hasOnlyDirectBranchPath = (
  call: EsTreeNodeOfType<"CallExpression">,
  body: EsTreeNodeOfType<"BlockStatement">,
  requireSingleStatement: boolean,
  isClosedCondition: (expression: EsTreeNode) => boolean,
): boolean => {
  const expression = findTransparentExpressionRoot(call);
  let current = expression.parent;
  if (!isNodeOfType(current, "ExpressionStatement") || current.expression !== expression)
    return false;
  while (current !== body) {
    const parent: EsTreeNode | null | undefined = current.parent;
    if (isNodeOfType(parent, "BlockStatement")) {
      const [statement, ...others] = parent.body;
      if (requireSingleStatement && (statement !== current || others.length !== 0)) return false;
    } else if (
      !isNodeOfType(parent, "IfStatement") ||
      (parent.consequent !== current && parent.alternate !== current) ||
      !isClosedCondition(parent.test)
    )
      return false;
    current = parent;
  }
  return true;
};

export const hasOnlyExclusiveConstantSetterSiblings = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const [value, ...otherValues] = call.arguments;
  if (
    call.optional ||
    otherValues.length !== 0 ||
    !isNodeOfType(value, "BinaryExpression") ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const pair = resolveReactUseStatePair(call.callee, scopes);
  if (
    !pair?.stateSymbol ||
    ![value.left, value.right].some(
      (operand) =>
        isNodeOfType(operand, "Identifier") && scopes.symbolFor(operand) === pair.stateSymbol,
    )
  )
    return false;
  const handler = findEnclosingFunction(call);
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.generator ||
    !isNodeOfType(handler.body, "BlockStatement")
  )
    return false;
  const handlerBody = handler.body;
  const [parameter, ...otherParameters] = handler.params;
  if ((parameter && !isNodeOfType(parameter, "Identifier")) || otherParameters.length !== 0)
    return false;
  const parameterSymbol =
    parameter && isNodeOfType(parameter, "Identifier") ? scopes.symbolFor(parameter) : null;
  const isReadonlyIdentifier = (expression: EsTreeNode): boolean => {
    if (!isNodeOfType(expression, "Identifier")) return false;
    const inputSymbol = scopes.symbolFor(expression);
    return Boolean(
      inputSymbol &&
      inputSymbol.references.every(
        (inputReference) =>
          inputReference.flag === "read" && !isWithinAssignmentTarget(inputReference.identifier),
      ),
    );
  };
  const isEventKey = (expression: EsTreeNode): boolean => {
    const member = stripParenExpression(expression);
    return Boolean(
      parameterSymbol &&
      isNodeOfType(member, "MemberExpression") &&
      !member.computed &&
      !member.optional &&
      isNodeOfType(member.property, "Identifier") &&
      member.property.name === "key" &&
      isNodeOfType(member.object, "Identifier") &&
      scopes.symbolFor(member.object) === parameterSymbol &&
      isReadonlyIdentifier(member.object),
    );
  };
  const isClosedCondition = (expression: EsTreeNode): boolean => {
    const condition = stripParenExpression(expression);
    if (
      !isNodeOfType(condition, "BinaryExpression") ||
      (condition.operator !== "===" && condition.operator !== "!==")
    )
      return false;
    return (
      (isPrimitiveLiteral(condition.left) &&
        (isReadonlyIdentifier(condition.right) || isEventKey(condition.right))) ||
      (isPrimitiveLiteral(condition.right) &&
        (isReadonlyIdentifier(condition.left) || isEventKey(condition.left)))
    );
  };
  const isStateOperand = (expression: EsTreeNode): boolean =>
    isNodeOfType(expression, "Identifier") &&
    scopes.symbolFor(expression) === pair.stateSymbol &&
    isReadonlyIdentifier(expression);
  const stateCall = pair.declarator.init;
  if (!isNodeOfType(stateCall, "CallExpression") || !hasClosedReactStateProvider(stateCall, scopes))
    return false;
  const [stateInitializer, ...extraInitializers] = stateCall.arguments;
  if (
    !isPrimitiveLiteral(stateInitializer) ||
    extraInitializers.length !== 0 ||
    !(
      (isStateOperand(value.left) &&
        (isPrimitiveLiteral(value.right) || isEventKey(value.right))) ||
      (isStateOperand(value.right) && (isPrimitiveLiteral(value.left) || isEventKey(value.left)))
    ) ||
    !hasOnlyDirectBranchPath(call, handlerBody, true, isClosedCondition)
  )
    return false;
  const initializer = findTransparentExpressionRoot(handler);
  const declaration = initializer.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== initializer ||
    !isNodeOfType(declaration.id, "Identifier") ||
    findEnclosingFunction(declaration) !== findEnclosingFunction(pair.declarator)
  )
    return false;
  const symbol = scopes.symbolFor(declaration.id);
  if (!symbol || getDirectConstInitializer(symbol) !== initializer) return false;
  const [reference, ...others] = symbol.references;
  if (
    !reference ||
    others.length !== 0 ||
    reference.flag !== "read" ||
    isWithinAssignmentTarget(reference.identifier)
  )
    return false;
  const referenceRoot = findTransparentExpressionRoot(reference.identifier);
  const container = referenceRoot.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== referenceRoot ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    attribute.value !== container ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !HTML_TAGS.has(opening.name.name) ||
    declaration.range[1] >= attribute.range[0] ||
    findEnclosingFunction(attribute) !== findEnclosingFunction(declaration)
  )
    return false;
  const attributeName = getJsxAttributeName(attribute.name);
  if (
    !attributeName ||
    !/^on[A-Z]/.test(attributeName) ||
    getAuthoritativeJsxAttribute(opening.attributes, attributeName) !== attribute
  )
    return false;
  if (
    !pair.setterSymbol.references.every((setterReference) => {
      const parent = setterReference.identifier.parent;
      return (
        setterReference.flag === "read" &&
        !isWithinAssignmentTarget(setterReference.identifier) &&
        isNodeOfType(parent, "CallExpression") &&
        parent.callee === setterReference.identifier &&
        findEnclosingFunction(parent) === handler
      );
    })
  )
    return false;
  const setterName = call.callee.name;
  let hasSibling = false;
  let closed = true;
  walkAst(handler, (node) => {
    if (
      node === call ||
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "Identifier") ||
      node.callee.name !== setterName
    )
      return;
    const [argument, ...extraArguments] = node.arguments;
    if (
      node.optional ||
      scopes.symbolFor(node.callee) !== pair.setterSymbol ||
      findEnclosingFunction(node) !== handler ||
      extraArguments.length !== 0 ||
      !isNodeOfType(argument, "Literal") ||
      (argument.value !== null && typeof argument.value === "object") ||
      !hasOnlyDirectBranchPath(node, handlerBody, false, isClosedCondition) ||
      !areNodesInMutuallyExclusiveBranches(call, node)
    )
      closed = false;
    hasSibling = true;
  });
  return closed && hasSibling;
};
