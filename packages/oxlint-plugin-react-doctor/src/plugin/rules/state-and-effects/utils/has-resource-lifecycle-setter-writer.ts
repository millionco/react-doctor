import type { Reference } from "eslint-scope";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../../constants/dom-property-tags.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getCallExpr, getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isSetterWiredToJsxHandler } from "./is-controlled-prop-mirror.js";

const RESOURCE_LIFECYCLE_EVENT_NAMES: ReadonlySet<string> = new Set([
  "onAbort",
  "onCanPlay",
  "onCanPlayThrough",
  "onEmptied",
  "onEncrypted",
  "onEnded",
  "onError",
  "onLoad",
  "onLoadedData",
  "onLoadedMetadata",
  "onLoadStart",
  "onProgress",
  "onStalled",
  "onSuspend",
  "onWaiting",
]);

const RESOURCE_IDENTITY_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "data",
  "href",
  "src",
  "srcSet",
]);

const writesFailureLatch = (setterReference: Reference): boolean => {
  const callExpression = getCallExpr(setterReference);
  if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return false;
  const writtenValue = callExpression.arguments?.[0] as EsTreeNode | undefined;
  return Boolean(isNodeOfType(writtenValue, "Literal") && writtenValue.value === true);
};

const isResourceLifecycleAttribute = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  dependencyVariables: ReadonlySet<unknown>,
  attribute: EsTreeNode,
): boolean => {
  if (!isNodeOfType(attribute, "JSXAttribute")) return false;
  const attributeName = getJsxAttributeName(attribute.name);
  if (!attributeName || !RESOURCE_LIFECYCLE_EVENT_NAMES.has(attributeName)) return false;
  const openingElement = attribute.parent;
  if (
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isProvenIntrinsicJsxElement(openingElement, context.scopes)
  ) {
    return false;
  }
  const elementName = resolveJsxElementType(openingElement);
  if (!DOM_PROPERTY_TO_ALLOWED_TAGS.get(attributeName)?.has(elementName)) return false;

  let readsDependency = false;
  for (const siblingAttribute of openingElement.attributes ?? []) {
    if (siblingAttribute === attribute) continue;
    if (
      !isNodeOfType(siblingAttribute, "JSXAttribute") ||
      !RESOURCE_IDENTITY_ATTRIBUTE_NAMES.has(getJsxAttributeName(siblingAttribute.name) ?? "")
    ) {
      continue;
    }
    walkAst(siblingAttribute, (child): boolean | void => {
      if (readsDependency) return false;
      if (!isNodeOfType(child, "Identifier")) return;
      const reference = getRef(analysis, child);
      if (reference?.resolved && dependencyVariables.has(reference.resolved)) {
        readsDependency = true;
        return false;
      }
    });
    if (readsDependency) break;
  }
  return readsDependency;
};

export const hasResourceLifecycleSetterWriter = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterReference: Reference,
  effectNode: EsTreeNode,
  dependencyReferences: readonly Reference[],
): boolean => {
  if (!setterReference.resolved) return false;
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction) return false;
  const dependencyVariables = new Set(
    dependencyReferences.flatMap((reference) => (reference.resolved ? [reference.resolved] : [])),
  );
  if (dependencyVariables.size === 0) return false;
  const matchesAttribute = (attribute: EsTreeNode): boolean =>
    isResourceLifecycleAttribute(analysis, context, dependencyVariables, attribute);

  for (const reference of setterReference.resolved.references) {
    if (reference.init) continue;
    if (!writesFailureLatch(reference)) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    let outermostFunctionBelowComponent: EsTreeNode | null = null;
    let cursor: EsTreeNode | null | undefined = identifier;
    while (cursor && cursor !== componentFunction) {
      if (isNodeOfType(cursor, "JSXAttribute") && matchesAttribute(cursor)) return true;
      if (isFunctionLike(cursor)) outermostFunctionBelowComponent = cursor;
      cursor = cursor.parent ?? null;
    }
    if (!outermostFunctionBelowComponent) continue;
    const bindingIdentifier = getFunctionBindingIdentifier(outermostFunctionBelowComponent);
    if (
      isNodeOfType(bindingIdentifier, "Identifier") &&
      isSetterWiredToJsxHandler(componentFunction, bindingIdentifier.name, matchesAttribute)
    ) {
      return true;
    }
  }
  return false;
};
