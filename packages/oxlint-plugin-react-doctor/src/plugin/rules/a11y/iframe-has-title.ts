import { defineRule } from "../../utils/define-rule.js";
import { PRESENTATION_ROLES, VALID_ARIA_ROLES } from "../../constants/aria-roles.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseJsxValue } from "../../utils/parse-jsx-value.js";

const MESSAGE =
  "Screen reader users cannot identify this `<iframe>` because it has no title. Add a `title` that describes its content.";

type StaticVerdict = "ok" | "empty" | "dynamic-ok";

const isStaticallyAriaHidden = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const ariaHiddenAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "aria-hidden",
    false,
  );
  if (!ariaHiddenAttribute) return false;
  if (!ariaHiddenAttribute.value) return true;
  const value = ariaHiddenAttribute.value;
  if (isNodeOfType(value, "Literal")) {
    return value.value === true || value.value === "true";
  }
  if (!isNodeOfType(value, "JSXExpressionContainer")) return false;
  return (
    isNodeOfType(value.expression, "Literal") &&
    (value.expression.value === true || value.expression.value === "true")
  );
};

const hasStaticallyNegativeTabIndex = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const tabIndexAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "tabIndex",
    false,
  );
  if (!tabIndexAttribute) return false;
  const value = tabIndexAttribute.value;
  if (
    value &&
    isNodeOfType(value, "JSXExpressionContainer") &&
    isNodeOfType(value.expression, "ConditionalExpression") &&
    !isNodeOfType(value.expression.test, "Literal")
  ) {
    return false;
  }
  const tabIndexValue = parseJsxValue(value);
  return tabIndexValue !== null && tabIndexValue < 0;
};

const hasStaticallyDecorativeRole = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
  if (!roleAttribute) return false;
  const roleCandidates = getJsxPropStaticStringValues(roleAttribute, scopes);
  return (
    roleCandidates !== null &&
    roleCandidates.length > 0 &&
    roleCandidates.every((roleCandidate) => {
      const firstValidRole = roleCandidate
        .split(/\s+/)
        .find((roleToken) => VALID_ARIA_ROLES.has(roleToken));
      return firstValidRole !== undefined && PRESENTATION_ROLES.has(firstValidRole);
    })
  );
};

const isInsideStaticallyHiddenJsxSubtree = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (isStaticallyAriaHidden(openingElement)) return true;

  let ancestor = openingElement.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) {
      const isChildrenAttribute =
        isNodeOfType(ancestor.name, "JSXIdentifier") && ancestor.name.name === "children";
      if (!isChildrenAttribute) return false;
    }

    if (
      isNodeOfType(ancestor, "JSXElement") &&
      !isJsxFragmentElement(ancestor.openingElement, scopes)
    ) {
      const ancestorName = ancestor.openingElement.name;
      if (!isNodeOfType(ancestorName, "JSXIdentifier")) return false;
      const firstCharacter = ancestorName.name[0];
      const isIntrinsicElement = firstCharacter === firstCharacter?.toLowerCase();
      if (!isIntrinsicElement) return false;
      if (isStaticallyAriaHidden(ancestor.openingElement)) return true;
    }

    if (
      isNodeOfType(ancestor, "CallExpression") ||
      isNodeOfType(ancestor, "NewExpression") ||
      isNodeOfType(ancestor, "VariableDeclarator") ||
      isNodeOfType(ancestor, "AssignmentExpression") ||
      isNodeOfType(ancestor, "Property") ||
      isFunctionLike(ancestor) ||
      isNodeOfType(ancestor, "Program")
    ) {
      return false;
    }

    ancestor = ancestor.parent;
  }

  return false;
};

const evaluateTitleValue = (value: EsTreeNode | null | undefined): StaticVerdict | "missing" => {
  if (!value) return "missing";
  if (isNodeOfType(value, "Literal")) {
    if (typeof value.value === "string") {
      return value.value.trim().length > 0 ? "ok" : "empty";
    }
    return "empty";
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal")) {
      if (typeof expression.value === "string") {
        return expression.value.trim().length > 0 ? "ok" : "empty";
      }
      return "empty";
    }
    if (isNodeOfType(expression, "Identifier")) {
      if (expression.name === "undefined") return "empty";
      return "dynamic-ok";
    }
    if (isNodeOfType(expression, "TemplateLiteral")) {
      // Template with interpolation → dynamic OK; pure-string check
      // cooked content for emptiness.
      const staticValue = getStaticTemplateLiteralValue(expression);
      return staticValue === null ? "dynamic-ok" : staticValue.length > 0 ? "ok" : "empty";
    }
    return "dynamic-ok";
  }
  return "ok";
};

// Port of `oxc_linter::rules::jsx_a11y::iframe_has_title`.
export const iframeHasTitle = defineRule({
  id: "iframe-has-title",
  title: "iframe missing title",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Add a descriptive `title` so screen reader users know what the embedded frame contains.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (tag !== "iframe") return;
      if (isInsideStaticallyHiddenJsxSubtree(node, context.scopes)) return;
      if (hasStaticallyNegativeTabIndex(node)) return;
      if (hasStaticallyDecorativeRole(node, context.scopes)) return;
      // Spread attribute → can't statically verify; flag.
      const hasSpread = node.attributes.some((attribute) =>
        isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute"),
      );
      const titleAttr = hasJsxPropIgnoreCase(node.attributes, "title");
      if (!titleAttr) {
        if (hasSpread || tag === "iframe") {
          context.report({ node: node.name, message: MESSAGE });
        }
        return;
      }
      const verdict = evaluateTitleValue(titleAttr.value as EsTreeNode | null | undefined);
      if (verdict === "missing" || verdict === "empty") {
        context.report({ node: titleAttr, message: MESSAGE });
      }
    },
  }),
});
