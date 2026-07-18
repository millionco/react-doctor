import { HTML_TAGS } from "../../constants/html-tags.js";
import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const POINTER_CAPTURE_METHODS = new Set([
  "hasPointerCapture",
  "releasePointerCapture",
  "setPointerCapture",
]);
const R3F_OBJECT_EVENT_FIELDS = new Set(["eventObject", "object"]);

const getDirectObjectPatternBindingPropertyName = (
  bindingIdentifier: EsTreeNode,
  objectPattern: EsTreeNode,
): string | null => {
  let bindingNode = bindingIdentifier;
  if (
    isNodeOfType(bindingNode.parent, "AssignmentPattern") &&
    bindingNode.parent.left === bindingNode
  ) {
    bindingNode = bindingNode.parent;
  }
  const property = bindingNode.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== bindingNode ||
    property.parent !== objectPattern
  ) {
    return null;
  }
  return getStaticPropertyKeyName(property, { allowComputedString: true });
};

const isR3fEventObject = (
  expression: EsTreeNode,
  eventParameter: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  const candidateSymbol = isNodeOfType(candidate, "Identifier")
    ? context.scopes.symbolFor(candidate)
    : null;
  if (isNodeOfType(candidate, "Identifier")) {
    if (!candidateSymbol) return false;
    const parameterPropertyName = isNodeOfType(eventParameter, "ObjectPattern")
      ? getDirectObjectPatternBindingPropertyName(candidateSymbol.bindingIdentifier, eventParameter)
      : null;
    if (
      parameterPropertyName &&
      R3F_OBJECT_EVENT_FIELDS.has(parameterPropertyName) &&
      candidateSymbol.references.every((reference) => reference.flag === "read")
    ) {
      return true;
    }
  }
  if (!isNodeOfType(eventParameter, "Identifier")) return false;
  const eventParameterKey = resolveExpressionKey(eventParameter, context);
  if (!eventParameterKey) return false;
  if (
    candidateSymbol?.kind === "const" &&
    candidateSymbol.initializer &&
    isNodeOfType(candidateSymbol.declarationNode, "VariableDeclarator") &&
    isNodeOfType(candidateSymbol.declarationNode.id, "ObjectPattern") &&
    R3F_OBJECT_EVENT_FIELDS.has(
      getDirectObjectPatternBindingPropertyName(
        candidateSymbol.bindingIdentifier,
        candidateSymbol.declarationNode.id,
      ) ?? "",
    ) &&
    candidateSymbol.references.every((reference) => reference.flag === "read") &&
    resolveExpressionKey(candidateSymbol.initializer, context) === eventParameterKey
  ) {
    return true;
  }
  const candidateKey = resolveExpressionKey(candidate, context);
  if (candidateKey) {
    for (const propertyName of R3F_OBJECT_EVENT_FIELDS) {
      if (candidateKey === `${eventParameterKey}.${propertyName}`) return true;
    }
  }
  if (
    isNodeOfType(candidate, "Identifier") &&
    candidateSymbol?.kind === "const" &&
    candidateSymbol.initializer &&
    isNodeOfType(candidateSymbol.declarationNode, "VariableDeclarator") &&
    candidateSymbol.declarationNode.id === candidateSymbol.bindingIdentifier &&
    !visitedSymbolIds.has(candidateSymbol.id) &&
    candidateSymbol.references.every((reference) => reference.flag === "read")
  ) {
    visitedSymbolIds.add(candidateSymbol.id);
    return isR3fEventObject(candidateSymbol.initializer, eventParameter, context, visitedSymbolIds);
  }
  return (
    isNodeOfType(candidate, "MemberExpression") &&
    R3F_OBJECT_EVENT_FIELDS.has(getStaticPropertyName(candidate) ?? "") &&
    resolveExpressionKey(candidate.object, context) === eventParameterKey
  );
};

const findInvalidPointerCaptureCalls = (
  handler: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] => {
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") &&
    !isNodeOfType(handler, "FunctionExpression") &&
    !isNodeOfType(handler, "FunctionDeclaration")
  ) {
    return [];
  }
  const rawEventParameter = handler.params[0];
  const eventParameter = isNodeOfType(rawEventParameter, "AssignmentPattern")
    ? rawEventParameter.left
    : rawEventParameter;
  if (
    !isNodeOfType(eventParameter, "Identifier") &&
    !isNodeOfType(eventParameter, "ObjectPattern")
  ) {
    return [];
  }
  const invalidCalls: EsTreeNode[] = [];
  walkFunctionExecution(handler, context.scopes, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      !POINTER_CAPTURE_METHODS.has(getStaticPropertyName(candidate.callee) ?? "") ||
      !isR3fEventObject(candidate.callee.object, eventParameter, context)
    ) {
      return;
    }
    invalidCalls.push(candidate);
  });
  return invalidCalls;
};

export const r3fNoObjectPointerCapture = defineRule({
  id: "r3f-no-object-pointer-capture",
  title: "Pointer capture called on an R3F scene object",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Call pointer-capture methods on the R3F event target or currentTarget, not object or eventObject",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        const elementType = resolveJsxElementType(node);
        if (
          !elementType ||
          elementType[0] !== elementType[0]?.toLowerCase() ||
          HTML_TAGS.has(elementType) ||
          (SVG_TAGS.has(elementType) && elementType !== "line")
        ) {
          return;
        }
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const attributeName = getJsxAttributeName(attribute.name);
          if (
            !attributeName?.startsWith("onPointer") ||
            getAuthoritativeJsxAttribute(node.attributes, attributeName) !== attribute ||
            !attribute.value ||
            !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
            isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
          ) {
            continue;
          }
          const handler = resolveLocalReactCallback(attribute.value.expression, context.scopes);
          if (!handler) continue;
          for (const invalidCall of findInvalidPointerCaptureCalls(handler, context)) {
            context.report({
              node: invalidCall,
              message:
                "R3F scene objects do not implement DOM pointer capture. Call this method on event.target or event.currentTarget",
            });
          }
        }
      },
    };
  },
});
