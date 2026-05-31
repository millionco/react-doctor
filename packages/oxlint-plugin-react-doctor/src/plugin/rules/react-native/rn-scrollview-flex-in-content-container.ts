import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { SCROLLVIEW_NAMES } from "./utils/scrollview_names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: in React Native, `flex` on `contentContainerStyle` is shorthand
// for `{ flexGrow, flexShrink, flexBasis: 0 }` — NOT CSS's
// `flex-basis: auto`. The practical result: when the inner content is
// taller than the viewport the container collapses to zero on small
// devices, even though the same code looks right on larger ones. The
// documented fix is `flexGrow: 1`, which keeps the "fill remaining
// space" semantics without the basis: 0 collapse.

const VIRTUALIZED_LIST_NAMES = new Set(["FlashList", "LegendList"]);

const getStaticMemberKeyName = (
  expression: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  if (!expression.computed) {
    if (isNodeOfType(expression.property, "Identifier")) return expression.property.name;
    return null;
  }
  // computed: `styles["container"]`
  if (
    isNodeOfType(expression.property, "Literal") &&
    typeof expression.property.value === "string"
  ) {
    return expression.property.value;
  }
  return null;
};

const isStyleSheetCreateCallExpression = (
  expression: EsTreeNode | null | undefined,
): expression is EsTreeNodeOfType<"CallExpression"> => {
  if (!expression) return false;
  const callExpression = stripParenExpression(expression);
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = callExpression.callee;
  // `StyleSheet.create(...)` — the only shape we recognize. Bare
  // `create({})` from a named import is too ambiguous on its own
  // (collides with too many user helpers); not followed today.
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "StyleSheet" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "create"
  );
};

const resolveContentContainerStyleObject = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (!isNodeOfType(attribute.name, "JSXIdentifier")) return null;
  if (attribute.name.name !== "contentContainerStyle") return null;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  // Inline literal: `contentContainerStyle={{ flex: 1 }}`
  if (isNodeOfType(expression, "ObjectExpression")) return expression;
  // StyleSheet reference: `contentContainerStyle={styles.container}` or
  // `contentContainerStyle={styles["container"]}`. Follow ONE level of
  // binding to the `StyleSheet.create({ container: { flex: 1 } })` map
  // and return the matched property's value. v1 doesn't follow chains
  // of intermediate identifiers.
  if (isNodeOfType(expression, "MemberExpression")) {
    const styleObjectKeyName = getStaticMemberKeyName(expression);
    if (!styleObjectKeyName) return null;
    const styleObjectIdentifierName = getRootIdentifierName(expression);
    if (!styleObjectIdentifierName) return null;
    const binding = findVariableInitializer(expression, styleObjectIdentifierName);
    if (!binding || !binding.initializer) return null;
    if (!isStyleSheetCreateCallExpression(binding.initializer)) return null;
    const styleSheetCall = stripParenExpression(
      binding.initializer,
    ) as EsTreeNodeOfType<"CallExpression">;
    const argument = styleSheetCall.arguments?.[0];
    if (!isNodeOfType(argument, "ObjectExpression")) return null;
    for (const property of argument.properties ?? []) {
      if (!isNodeOfType(property, "Property")) continue;
      if (property.computed) continue;
      let matchesKey = false;
      if (isNodeOfType(property.key, "Identifier")) {
        matchesKey = property.key.name === styleObjectKeyName;
      } else if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
        matchesKey = property.key.value === styleObjectKeyName;
      }
      if (!matchesKey) continue;
      const propertyValue = stripParenExpression(property.value);
      if (isNodeOfType(propertyValue, "ObjectExpression")) return propertyValue;
      return null;
    }
  }
  return null;
};

const collectStyleKeyNames = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): Set<string> => {
  const names = new Set<string>();
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    if (isNodeOfType(property.key, "Identifier")) names.add(property.key.name);
    else if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
      names.add(property.key.value);
    }
  }
  return names;
};

const findFlexShorthandProperty = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): EsTreeNodeOfType<"Property"> | null => {
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    if (!isNodeOfType(property.key, "Identifier") || property.key.name !== "flex") continue;
    const value: EsTreeNode | null | undefined = property.value;
    if (!isNodeOfType(value, "Literal")) return null;
    // RN `flex: 0` is the "non-flexible, sized by width/height" mode —
    // intentional, not the CSS shorthand confusion. Same for negative
    // numbers (legitimate RN-only escape hatch). Only positive numbers
    // mirror the CSS `flex: 1` mistake.
    if (typeof value.value !== "number" || value.value <= 0) return null;
    return property;
  }
  return null;
};

export const rnScrollviewFlexInContentContainer = defineRule<Rule>({
  id: "rn-scrollview-flex-in-content-container",
  title: "flex on contentContainerStyle collapses container",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "In RN, `flex: 1` on `contentContainerStyle` sets `flexBasis: 0` and can collapse the container on small screens. Use `flexGrow: 1` instead.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (!elementName) return;
      if (!SCROLLVIEW_NAMES.has(elementName) && !VIRTUALIZED_LIST_NAMES.has(elementName)) return;

      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const objectExpression = resolveContentContainerStyleObject(attribute);
        if (!objectExpression) continue;

        const keyNames = collectStyleKeyNames(objectExpression);
        // Explicit `flexGrow` / `flexBasis` alongside `flex: 1` signals
        // the author already understands the trade-off and is overriding
        // one of the shorthand's slots. Stay quiet — flagging here would
        // train people to delete the override and reintroduce the bug.
        if (keyNames.has("flexGrow") || keyNames.has("flexBasis")) continue;

        const flexProperty = findFlexShorthandProperty(objectExpression);
        if (!flexProperty) continue;

        context.report({
          node: flexProperty,
          message: `\`flex\` on contentContainerStyle can collapse the container on small screens.`,
        });
      }
    },
  }),
});
