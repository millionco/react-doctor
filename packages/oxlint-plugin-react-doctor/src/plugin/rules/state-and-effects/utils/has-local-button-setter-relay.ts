import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasPossibleStaticPropertyMutationOrEscapeBefore } from "../../../utils/has-static-property-write-before.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isInsideStaticallyHiddenJsxSubtree } from "../../../utils/is-inside-statically-hidden-jsx-subtree.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const reservedProps = new Set(["key", "ref", "__self", "__source"]);
const containerAttributes = new Set(["className", "id"]);
const buttonAttributes = new Set(["className", "id", "onClick", "type"]);

const hasOnlyAttributes = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  allowed: ReadonlySet<string>,
): boolean =>
  opening.attributes.every(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      allowed.has(getJsxAttributeName(attribute.name) ?? ""),
  );

const getFinalReturn = (component: EsTreeNode): EsTreeNodeOfType<"ReturnStatement"> | null => {
  if (!isFunctionLike(component) || !isNodeOfType(component.body, "BlockStatement")) return null;
  const statement = component.body.body.at(-1);
  if (!isNodeOfType(statement, "ReturnStatement")) return null;
  let hasAnotherReturn = false;
  walkAst(component.body, (node) => {
    if (hasAnotherReturn || isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node !== statement) {
      hasAnotherReturn = true;
      return false;
    }
  });
  return hasAnotherReturn ? null : statement;
};

const preservesNativeArrayMap = (context: RuleContext): boolean => {
  const { scopes } = context;
  let preservesMap = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!preservesMap || isKeyedDraftTypeReference(node)) return false;
    if (
      (isNodeOfType(node, "Identifier") || isNodeOfType(node, "MemberExpression")) &&
      isProvenGlobalNamespaceReference(node, "Array", scopes) &&
      !isProvenUnmodifiedGlobalNamespaceReference(node, "Array", scopes, undefined, true)
    ) {
      preservesMap = false;
      return false;
    }
  });
  return preservesMap;
};

const isReturnedArrayMap = (
  map: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    map.optional ||
    map.arguments.length !== 1 ||
    map.arguments[0] !== callback ||
    !isFunctionLike(owner)
  ) {
    return false;
  }
  const member = stripParenExpression(map.callee);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "map" ||
    !isNodeOfType(member.object, "Identifier")
  ) {
    return false;
  }
  const { scopes } = context;
  const array = scopes.symbolFor(member.object);
  const parameter = owner.params[0];
  if (
    !array ||
    array.kind !== "parameter" ||
    !isSymbolReadOnly(array) ||
    !isNodeOfType(parameter, "ObjectPattern") ||
    array.bindingIdentifier.parent?.parent !== parameter ||
    !isNodeOfType(parameter.typeAnnotation, "TSTypeAnnotation") ||
    !isNodeOfType(parameter.typeAnnotation.typeAnnotation, "TSTypeLiteral")
  ) {
    return false;
  }
  const propName = getDestructuredBindingPropertyName(array.bindingIdentifier);
  // The annotation establishes the ordinary Array contract for a destructured prop.
  // Visible mutation or escape of the receiver before the map invalidates it.
  return (
    propName !== null &&
    parameter.typeAnnotation.typeAnnotation.members.some(
      (property) =>
        isNodeOfType(property, "TSPropertySignature") &&
        !property.optional &&
        !property.computed &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === propName &&
        isNodeOfType(property.typeAnnotation?.typeAnnotation, "TSArrayType"),
    ) &&
    hasCompleteSymbolReferences(array, scopes.rootScope.node, scopes) &&
    !hasPossibleStaticPropertyMutationOrEscapeBefore(member.object, "map", map, scopes) &&
    preservesNativeArrayMap(context)
  );
};

const isInReturnedRenderTree = (
  element: EsTreeNodeOfType<"JSXElement">,
  owner: EsTreeNode,
  rowReceiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const returned = getFinalReturn(owner);
  if (!returned || !isNodeReachableWithinFunction(returned, context)) return false;

  let current: EsTreeNode = element;
  let followedMap = false;
  while (true) {
    current = findTransparentExpressionRoot(current);
    const parent = current.parent;
    if (parent === returned) return followedMap && returned.argument === current;

    if (isNodeOfType(parent, "JSXElement")) {
      const opening = parent.openingElement;
      if (
        !parent.children.some((child) => child === current) ||
        !isNodeOfType(opening.name, "JSXIdentifier") ||
        opening.name.name !== "div" ||
        !hasOnlyAttributes(opening, containerAttributes)
      ) {
        return false;
      }
    } else if (isNodeOfType(parent, "JSXFragment")) {
      if (!parent.children.some((child) => child === current)) return false;
    } else if (isNodeOfType(parent, "JSXExpressionContainer")) {
      if (parent.expression !== current) return false;
      if (
        !isNodeOfType(parent.parent, "JSXElement") &&
        !isNodeOfType(parent.parent, "JSXFragment")
      ) {
        return false;
      }
    } else if (
      !followedMap &&
      isNodeOfType(parent, "ArrowFunctionExpression") &&
      !parent.async &&
      parent.body === current
    ) {
      const callback = findTransparentExpressionRoot(parent);
      const map = callback.parent;
      const rowParameter = parent.params[0];
      const rowSymbol = context.scopes.symbolFor(rowReceiver);
      if (
        !isNodeOfType(map, "CallExpression") ||
        !isNodeOfType(rowParameter, "Identifier") ||
        !rowSymbol ||
        context.scopes.symbolFor(rowParameter) !== rowSymbol ||
        !isSymbolReadOnly(rowSymbol) ||
        !isReturnedArrayMap(map, callback, owner, context)
      ) {
        return false;
      }
      followedMap = true;
      current = map;
      continue;
    } else {
      return false;
    }
    current = parent;
  }
};

const forwardsPropToReturnedButton = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  propName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  const { scopes } = context;
  const component = scopes.symbolFor(opening.name);
  const child = component?.declarationNode;
  const program = scopes.rootScope.node;
  if (
    !component ||
    component.kind !== "function" ||
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !isNodeOfType(child, "FunctionDeclaration") ||
    child.parent !== program ||
    child.async ||
    child.generator ||
    !isSymbolReadOnly(component) ||
    !hasCompleteSymbolReferences(component, program, scopes)
  ) {
    return false;
  }
  const parameter = child.params[0];
  const returned = getFinalReturn(child);
  if (!isNodeOfType(parameter, "ObjectPattern") || !returned?.argument) return false;
  const button = stripParenExpression(returned.argument);
  if (!isNodeOfType(button, "JSXElement")) return false;
  const buttonOpening = button.openingElement;
  if (
    !isNodeOfType(buttonOpening.name, "JSXIdentifier") ||
    buttonOpening.name.name !== "button" ||
    !hasOnlyAttributes(buttonOpening, buttonAttributes) ||
    isInsideStaticallyHiddenJsxSubtree(button, context) ||
    !isNodeReachableWithinFunction(returned, context)
  ) {
    return false;
  }

  const onClick = getAuthoritativeJsxAttribute(buttonOpening.attributes, "onClick");
  if (!isNodeOfType(onClick?.value, "JSXExpressionContainer")) return false;
  const callback = stripParenExpression(onClick.value.expression);
  if (!isNodeOfType(callback, "Identifier")) return false;
  const binding = scopes.symbolFor(callback);
  const property = binding?.bindingIdentifier.parent;
  return Boolean(
    binding?.kind === "parameter" &&
    isNodeOfType(property, "Property") &&
    !property.computed &&
    property.value === binding.bindingIdentifier &&
    property.parent === parameter &&
    getDestructuredBindingPropertyName(binding.bindingIdentifier) === propName &&
    isSymbolReadOnly(binding) &&
    hasCompleteSymbolReferences(binding, program, scopes) &&
    binding.references.every(
      ({ identifier }) => identifier === callback || isKeyedDraftTypeReference(identifier),
    ),
  );
};

const getToggleRowReceiver = (
  call: EsTreeNodeOfType<"CallExpression">,
  stateDeclaration: EsTreeNode | null,
  context: RuleContext,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    !isNodeOfType(stateDeclaration, "VariableDeclarator") ||
    !isNodeOfType(stateDeclaration.id, "ArrayPattern") ||
    call.arguments.length !== 1
  ) {
    return null;
  }
  const stateBinding = stateDeclaration.id.elements[0];
  const update = stripParenExpression(call.arguments[0]);
  if (
    !isNodeOfType(stateBinding, "Identifier") ||
    !isNodeOfType(update, "ConditionalExpression") ||
    !isNodeOfType(update.consequent, "Literal") ||
    update.consequent.value !== null ||
    !isNodeOfType(update.test, "BinaryExpression") ||
    update.test.operator !== "==="
  ) {
    return null;
  }
  const stored = stripParenExpression(update.test.left);
  const comparison = stripParenExpression(update.test.right);
  const selected = stripParenExpression(update.alternate);
  if (
    !isNodeOfType(stored, "Identifier") ||
    !isNodeOfType(comparison, "MemberExpression") ||
    !isNodeOfType(selected, "MemberExpression") ||
    comparison.computed ||
    comparison.optional ||
    selected.computed ||
    selected.optional ||
    !isNodeOfType(comparison.property, "Identifier") ||
    !isNodeOfType(selected.property, "Identifier") ||
    comparison.property.name !== selected.property.name ||
    !isNodeOfType(comparison.object, "Identifier") ||
    !isNodeOfType(selected.object, "Identifier")
  ) {
    return null;
  }
  const { scopes } = context;
  const state = scopes.symbolFor(stateBinding);
  const value = scopes.symbolFor(selected.object);
  return state &&
    value &&
    state === scopes.symbolFor(stored) &&
    value === scopes.symbolFor(comparison.object)
    ? selected.object
    : null;
};

export const hasLocalButtonSetterRelay = (
  setter: EsTreeNode,
  owner: EsTreeNode,
  stateDeclaration: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  const callee = findTransparentExpressionRoot(setter);
  const call = callee.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== callee || call.optional) {
    return false;
  }
  const rowReceiver = getToggleRowReceiver(call, stateDeclaration, context);
  if (!rowReceiver) return false;
  const callback = findEnclosingFunction(call);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.body !== findTransparentExpressionRoot(call)
  ) {
    return false;
  }
  const callbackExpression = findTransparentExpressionRoot(callback);
  const container = callbackExpression.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== callbackExpression
  ) {
    return false;
  }
  const attribute = container.parent;
  if (!isNodeOfType(attribute, "JSXAttribute")) return false;
  const propName = getJsxAttributeName(attribute.name);
  const opening = attribute.parent;
  if (
    !propName ||
    reservedProps.has(propName) ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    getAuthoritativeJsxAttribute(opening.attributes, propName) !== attribute
  ) {
    return false;
  }
  const element = opening.parent;
  return (
    isNodeOfType(element, "JSXElement") &&
    isInReturnedRenderTree(element, owner, rowReceiver, context) &&
    !isInsideStaticallyHiddenJsxSubtree(element, context) &&
    forwardsPropToReturnedButton(opening, propName, context)
  );
};
