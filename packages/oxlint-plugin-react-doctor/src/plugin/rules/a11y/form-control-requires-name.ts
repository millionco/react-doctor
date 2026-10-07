import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { isReactDomCreatePortalCall } from "../../utils/function-contains-react-render-output.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const FORM_CONTROL_TAG_NAMES = new Set(["input", "select", "textarea"]);
const NON_DATA_INPUT_TYPES = new Set(["button", "image", "reset", "submit"]);

const nameAttributeMaySubmitData = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (!attribute.value) return false;
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) return staticStringValue.length > 0;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    return expression.value !== null && typeof expression.value !== "boolean";
  }
  if (isLiteralVoidExpression(expression)) return false;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return false;
  }
  return true;
};

const openingElementMayBeDisabled = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, "disabled", false);
  if (!attribute) {
    return hasJsxSpreadThatMayProvideAttribute(node.attributes, "disabled");
  }
  if (!attribute.value) return true;
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) return staticStringValue.length > 0;
  const value = isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? stripParenExpression(attribute.value.expression)
    : attribute.value;
  if (isNodeOfType(value, "Literal")) return Boolean(value.value);
  if (isLiteralVoidExpression(value)) return false;
  if (
    isNodeOfType(value, "Identifier") &&
    value.name === "undefined" &&
    context.scopes.isGlobalReference(value)
  ) {
    return false;
  }
  return true;
};

const inputTypeMaySubmitData = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
  hasUnresolvedTypeSpread: boolean,
  context: RuleContext,
): boolean => {
  if (!attribute) return !hasUnresolvedTypeSpread;
  const inputType = getStringLiteralAttributeValue(attribute);
  if (inputType !== null) return !NON_DATA_INPUT_TYPES.has(inputType.toLowerCase());
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isLiteralVoidExpression(expression)) return true;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return true;
  }
  return false;
};

const getStaticDomStringAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): string | null | undefined => {
  if (!attribute.value) return "";
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) return staticStringValue;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return undefined;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    if (expression.value === null || typeof expression.value === "boolean") return null;
    return String(expression.value);
  }
  if (isLiteralVoidExpression(expression)) return null;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return null;
  }
  return undefined;
};

const collectPotentialLegends = (
  node: EsTreeNode,
  legends: Array<EsTreeNodeOfType<"JSXElement">>,
): void => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "JSXElement")) {
    if (resolveJsxElementType(expression.openingElement) === "legend") legends.push(expression);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    collectPotentialLegends(expression.right, legends);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    collectPotentialLegends(expression.consequent, legends);
    collectPotentialLegends(expression.alternate, legends);
  }
};

const getFirstLegendChild = (
  children: ReadonlyArray<EsTreeNode>,
  targetNode: EsTreeNode,
): EsTreeNodeOfType<"JSXElement"> | null => {
  for (const child of children) {
    if (
      isNodeOfType(child, "JSXElement") &&
      resolveJsxElementType(child.openingElement) === "legend"
    ) {
      return child;
    }
    if (isNodeOfType(child, "JSXFragment")) {
      const legend = getFirstLegendChild(child.children, targetNode);
      if (legend) return legend;
    }
    if (isNodeOfType(child, "JSXExpressionContainer")) {
      const potentialLegends: Array<EsTreeNodeOfType<"JSXElement">> = [];
      collectPotentialLegends(child.expression, potentialLegends);
      const containingLegend = potentialLegends.find((legend) =>
        isDescendantOf(targetNode, legend),
      );
      if (containingLegend) return containingLegend;
      if (potentialLegends[0]) return potentialLegends[0];
    }
  }
  return null;
};

const isDescendantOf = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const isReturnedFromFunction = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let current: EsTreeNode = node;
  let didCrossReturnStatement = false;
  while (current.parent && current.parent !== functionNode) {
    current = current.parent;
    if (isNodeOfType(current, "ReturnStatement")) didCrossReturnStatement = true;
    if (
      isNodeOfType(current, "VariableDeclarator") ||
      isNodeOfType(current, "JSXAttribute") ||
      isNodeOfType(current, "Property")
    ) {
      return false;
    }
  }
  if (!current.parent) return false;
  if (isNodeOfType(functionNode, "ArrowFunctionExpression")) {
    return !isNodeOfType(functionNode.body, "BlockStatement") || didCrossReturnStatement;
  }
  return didCrossReturnStatement;
};

const isDisabledByFieldsetAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      resolveJsxElementType(ancestor.openingElement) === "fieldset" &&
      openingElementMayBeDisabled(ancestor.openingElement, context)
    ) {
      const firstLegend = getFirstLegendChild(ancestor.children, node);
      if (!firstLegend || !isDescendantOf(node, firstLegend)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const hasFormAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return false;
    if (isReactDomCreatePortalCall(ancestor, context.scopes)) return false;
    if (
      isFunctionLike(ancestor) &&
      (!executesDuringRender(ancestor, context.scopes) || !isReturnedFromFunction(node, ancestor))
    ) {
      return false;
    }
    if (isNodeOfType(ancestor, "JSXElement")) {
      const elementType = resolveJsxElementType(ancestor.openingElement);
      if (elementType === "form") return true;
      if (elementType[0] !== elementType[0]?.toLowerCase()) return false;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const getRenderOwner = (node: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  let renderOwner = findEnclosingFunction(node);
  while (
    renderOwner &&
    executesDuringRender(renderOwner, context.scopes) &&
    isReturnedFromFunction(node, renderOwner)
  ) {
    renderOwner = findEnclosingFunction(renderOwner);
  }
  if (renderOwner) return renderOwner;
  let topLevelOwner: EsTreeNode | null = null;
  let ancestor = node.parent;
  while (ancestor && !isNodeOfType(ancestor, "Program")) {
    topLevelOwner = ancestor;
    ancestor = ancestor.parent;
  }
  return topLevelOwner;
};

const isInsideReactPortal = (node: EsTreeNode, context: RuleContext): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isReactDomCreatePortalCall(ancestor, context.scopes)) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const expressionMayRenderElement = (
  expression: EsTreeNode,
  targetElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (candidate === targetElement) return true;
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectUnreassignedInitializer(symbol);
    if (!initializer) return false;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return expressionMayRenderElement(initializer, targetElement, context, nextVisitedSymbolIds);
  }
  if (isNodeOfType(candidate, "JSXElement") || isNodeOfType(candidate, "JSXFragment")) {
    return candidate.children.some((child) =>
      expressionMayRenderElement(child, targetElement, context, new Set(visitedSymbolIds)),
    );
  }
  if (isNodeOfType(candidate, "JSXExpressionContainer")) {
    return expressionMayRenderElement(
      candidate.expression,
      targetElement,
      context,
      visitedSymbolIds,
    );
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return (
      expressionMayRenderElement(
        candidate.consequent,
        targetElement,
        context,
        new Set(visitedSymbolIds),
      ) ||
      expressionMayRenderElement(
        candidate.alternate,
        targetElement,
        context,
        new Set(visitedSymbolIds),
      )
    );
  }
  if (isNodeOfType(candidate, "LogicalExpression")) {
    if (candidate.operator === "&&") {
      return expressionMayRenderElement(
        candidate.right,
        targetElement,
        context,
        new Set(visitedSymbolIds),
      );
    }
    return (
      expressionMayRenderElement(
        candidate.left,
        targetElement,
        context,
        new Set(visitedSymbolIds),
      ) ||
      expressionMayRenderElement(candidate.right, targetElement, context, new Set(visitedSymbolIds))
    );
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    return candidate.elements.some(
      (element) =>
        element !== null &&
        !isNodeOfType(element, "SpreadElement") &&
        expressionMayRenderElement(element, targetElement, context, new Set(visitedSymbolIds)),
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const returnedExpression = candidate.expressions.at(-1);
    return returnedExpression
      ? expressionMayRenderElement(returnedExpression, targetElement, context, visitedSymbolIds)
      : false;
  }
  return false;
};

const renderOwnerMayRenderElement = (
  renderOwner: EsTreeNode | null,
  targetElement: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): boolean => {
  if (!renderOwner || !isFunctionLike(renderOwner) || !renderOwner.body) return true;
  const returnedExpressions = isNodeOfType(renderOwner.body, "BlockStatement")
    ? collectFunctionReturnStatements(renderOwner).flatMap((returnStatement) =>
        returnStatement.argument ? [returnStatement.argument] : [],
      )
    : [renderOwner.body];
  return returnedExpressions.some((returnedExpression) =>
    expressionMayRenderElement(returnedExpression, targetElement, context),
  );
};

export const formControlRequiresName = defineRule({
  id: "form-control-requires-name",
  title: "Form control is omitted from named submission data",
  severity: "warn",
  category: "Correctness",
  defaultEnabled: false,
  recommendation:
    "Give each data-bearing native control inside a form a stable name for FormData, autofill, and non-JavaScript submission.",
  create: (context: RuleContext) => {
    const staticIdElementsByOwner = new Map<
      EsTreeNode | null,
      Map<
        string,
        Array<{
          elementType: string;
          node: EsTreeNodeOfType<"JSXOpeningElement">;
        }>
      >
    >();
    const externallyOwnedControlCandidates: Array<{
      formId: string;
      node: EsTreeNodeOfType<"JSXOpeningElement">;
      owner: EsTreeNode | null;
    }> = [];
    const reportControl = (node: EsTreeNodeOfType<"JSXOpeningElement">): void => {
      context.report({
        node,
        message:
          "This native control belongs to a form but has no name, so its value is omitted from FormData and native submission. Add a stable name.",
      });
    };

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tagName = resolveJsxElementType(node);
        const isGeneratedImage = isGeneratedImageRenderContext(context, node);
        if (!isGeneratedImage && !isInsideReactPortal(node, context)) {
          const idAttribute = getAuthoritativeJsxAttribute(node.attributes, "id", false);
          const elementId = idAttribute
            ? getStaticDomStringAttributeValue(idAttribute, context)
            : null;
          if (elementId) {
            const owner = getRenderOwner(node, context);
            if (
              !isNodeOfType(node.parent, "JSXElement") ||
              !renderOwnerMayRenderElement(owner, node.parent, context)
            ) {
              return;
            }
            const staticIdElements = staticIdElementsByOwner.get(owner) ?? new Map();
            const matchingElements = staticIdElements.get(elementId) ?? [];
            matchingElements.push({ elementType: tagName, node });
            staticIdElements.set(elementId, matchingElements);
            staticIdElementsByOwner.set(owner, staticIdElements);
          }
        }
        if (tagName === "form") {
          return;
        }
        if (
          !FORM_CONTROL_TAG_NAMES.has(tagName) ||
          isGeneratedImage ||
          openingElementMayBeDisabled(node, context) ||
          isDisabledByFieldsetAncestor(node, context)
        ) {
          return;
        }
        if (tagName === "input") {
          const typeAttribute = getAuthoritativeJsxAttribute(node.attributes, "type", false);
          if (
            !inputTypeMaySubmitData(
              typeAttribute,
              hasJsxSpreadThatMayProvideAttribute(node.attributes, "type"),
              context,
            )
          ) {
            return;
          }
        }
        const nameAttribute = getAuthoritativeJsxAttribute(node.attributes, "name", false);
        if (nameAttribute && nameAttributeMaySubmitData(nameAttribute, context)) return;
        if (!nameAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "name")) {
          return;
        }
        const formAttribute = getAuthoritativeJsxAttribute(node.attributes, "form", false);
        let isFormOwnerAttributeAbsent = !hasJsxSpreadThatMayProvideAttribute(
          node.attributes,
          "form",
        );
        if (formAttribute) {
          const formId = getStaticDomStringAttributeValue(formAttribute, context);
          if (formId === undefined || formId === "") return;
          if (formId !== null) {
            if (isInsideReactPortal(node, context)) return;
            externallyOwnedControlCandidates.push({
              formId,
              node,
              owner: getRenderOwner(node, context),
            });
            return;
          }
          isFormOwnerAttributeAbsent = true;
        }
        if (!isFormOwnerAttributeAbsent || !hasFormAncestor(node, context)) return;
        reportControl(node);
      },
      "Program:exit"() {
        for (const candidate of externallyOwnedControlCandidates) {
          const matchingElements =
            staticIdElementsByOwner
              .get(candidate.owner)
              ?.get(candidate.formId)
              ?.filter((element) => nodesCanCoExecute(element.node, candidate.node, context)) ?? [];
          if (matchingElements.length === 1 && matchingElements[0]?.elementType === "form") {
            reportControl(candidate.node);
          }
        }
      },
    };
  },
});
