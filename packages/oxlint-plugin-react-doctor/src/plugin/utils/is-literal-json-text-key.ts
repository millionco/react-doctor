import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import {
  LITERAL_JSON_TEXT_CALLBACK_PARAMETER_COUNT,
  LITERAL_JSON_TEXT_CALL_ARGUMENT_COUNT,
  LITERAL_JSON_TEXT_KEY_ATTRIBUTE_COUNT,
  LITERAL_JSON_TEXT_TAG_NAMES,
  LITERAL_JSON_TEXT_UNSAFE_PROPERTY_NAMES,
} from "./constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseStaticJsonLiteral } from "./parse-static-json-literal.js";
import { walkAst } from "./walk-ast.js";

interface LiteralJsonTextKeyInput {
  readonly keyAttribute: EsTreeNodeOfType<"JSXAttribute">;
  readonly iteratorCall: EsTreeNodeOfType<"CallExpression">;
  readonly scopes: ScopeAnalysis;
}

const intrinsicReadResults = new WeakMap<ScopeAnalysis, boolean>();

const isLiteralJsonParse = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== LITERAL_JSON_TEXT_CALL_ARGUMENT_COUNT ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    node.callee.optional ||
    !isNodeOfType(node.callee.object, "Identifier") ||
    node.callee.object.name !== "JSON" ||
    !scopes.isGlobalReference(node.callee.object) ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== "parse"
  )
    return false;
  const argument = node.arguments[0];
  if (!isNodeOfType(argument, "Literal") || typeof argument.value !== "string") return false;
  const parsed = parseStaticJsonLiteral(argument);
  return Boolean(
    parsed &&
    Array.isArray(parsed.value) &&
    parsed.value.every(
      (item: unknown) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    ),
  );
};

const hasOnlyClosedIntrinsicReads = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = intrinsicReadResults.get(scopes);
  if (cached !== undefined) return cached;
  let hasOnlyClosedReads = true;
  // The exception assumes ordinary native intrinsics; local escapes and prototype recovery veto it.
  walkAst(program, (node) => {
    if (!hasOnlyClosedReads) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed ||
          LITERAL_JSON_TEXT_UNSAFE_PROPERTY_NAMES.has(getStaticPropertyKeyName(node) ?? ""))) ||
      (isNodeOfType(node, "Property") &&
        (node.computed ||
          LITERAL_JSON_TEXT_UNSAFE_PROPERTY_NAMES.has(getStaticPropertyKeyName(node) ?? ""))) ||
      (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) ||
      (isNodeOfType(node, "UpdateExpression") && isNodeOfType(node.argument, "MemberExpression")) ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    ) {
      hasOnlyClosedReads = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    const member = node.parent;
    const call = member?.parent;
    if (
      node.name !== "JSON" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      !isLiteralJsonParse(call, scopes)
    )
      hasOnlyClosedReads = false;
  });
  intrinsicReadResults.set(scopes, hasOnlyClosedReads);
  return hasOnlyClosedReads;
};

export const isLiteralJsonTextKey = ({
  keyAttribute,
  iteratorCall,
  scopes,
}: LiteralJsonTextKeyInput): boolean => {
  const iteratorMember = iteratorCall.callee;
  const callback = iteratorCall.arguments[0];
  if (
    iteratorCall.optional ||
    iteratorCall.arguments.length !== LITERAL_JSON_TEXT_CALL_ARGUMENT_COUNT ||
    !isNodeOfType(iteratorMember, "MemberExpression") ||
    iteratorMember.computed ||
    iteratorMember.optional ||
    !isNodeOfType(iteratorMember.property, "Identifier") ||
    iteratorMember.property.name !== "map" ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.returnType ||
    callback.typeParameters ||
    callback.params.length !== LITERAL_JSON_TEXT_CALLBACK_PARAMETER_COUNT ||
    !isNodeOfType(callback.body, "JSXElement")
  )
    return false;
  const [itemParameter, indexParameter] = callback.params;
  if (
    !isNodeOfType(itemParameter, "Identifier") ||
    itemParameter.typeAnnotation ||
    itemParameter.optional ||
    !isNodeOfType(indexParameter, "Identifier") ||
    indexParameter.typeAnnotation ||
    indexParameter.optional ||
    itemParameter.name === indexParameter.name
  )
    return false;
  const leaf = callback.body;
  const opening = leaf.openingElement;
  const keyValue = keyAttribute.value;
  if (
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !LITERAL_JSON_TEXT_TAG_NAMES.has(opening.name.name) ||
    opening.typeArguments ||
    !leaf.closingElement ||
    !isNodeOfType(leaf.closingElement.name, "JSXIdentifier") ||
    leaf.closingElement.name.name !== opening.name.name ||
    opening.attributes.length !== LITERAL_JSON_TEXT_KEY_ATTRIBUTE_COUNT ||
    opening.attributes[0] !== keyAttribute ||
    !isNodeOfType(keyAttribute.name, "JSXIdentifier") ||
    keyAttribute.name.name !== "key" ||
    !isNodeOfType(keyValue, "JSXExpressionContainer") ||
    !isNodeOfType(keyValue.expression, "Identifier") ||
    scopes.symbolFor(keyValue.expression)?.bindingIdentifier !== indexParameter
  )
    return false;
  let itemChild: EsTreeNode | null = null;
  for (const child of leaf.children) {
    if (isNodeOfType(child, "JSXText") && child.value.trim() === "") continue;
    if (
      itemChild ||
      !isNodeOfType(child, "JSXExpressionContainer") ||
      !isNodeOfType(child.expression, "Identifier") ||
      scopes.symbolFor(child.expression)?.bindingIdentifier !== itemParameter
    )
      return false;
    itemChild = child.expression;
  }
  if (
    !itemChild ||
    !scopes
      .symbolFor(itemParameter)
      ?.references.every((reference) => reference.identifier === itemChild) ||
    !scopes
      .symbolFor(indexParameter)
      ?.references.every((reference) => reference.identifier === keyValue.expression)
  )
    return false;
  const container = iteratorCall.parent;
  const parentElement = container?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== iteratorCall ||
    !isNodeOfType(parentElement, "JSXElement") ||
    !parentElement.children.some((child) => child === container) ||
    !isNodeOfType(parentElement.openingElement.name, "JSXIdentifier") ||
    !HTML_TAGS.has(parentElement.openingElement.name.name) ||
    !isLiteralJsonParse(iteratorMember.object, scopes)
  )
    return false;
  const program = findProgramRoot(iteratorCall);
  return Boolean(program && hasOnlyClosedIntrinsicReads(program, scopes));
};
