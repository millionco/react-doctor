import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isOctaneModule } from "../../utils/is-octane-module.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);
const NON_DOM_OCTANE_RENDERER_PATTERN = /@jsxImportSource\s+@octanejs\/[^\s*]+\/intrinsics\b/;
const UNKNOWN_STATIC_VALUE = Symbol("unknown-static-value");

const findLastAttribute = (
  attributes: ReadonlyArray<EsTreeNode>,
  attributeName: string,
  alias?: string,
): EsTreeNodeOfType<"JSXAttribute"> | null => {
  for (let attributeIndex = attributes.length - 1; attributeIndex >= 0; attributeIndex -= 1) {
    const attribute = attributes[attributeIndex];
    if (
      attribute &&
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      (attribute.name.name === attributeName || attribute.name.name === alias)
    ) {
      return attribute;
    }
  }
  return null;
};

const getAttributeStaticValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): unknown => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return UNKNOWN_STATIC_VALUE;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) return expression.value;
  if (isNodeOfType(expression, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(expression) ?? UNKNOWN_STATIC_VALUE;
  }
  if (isNodeOfType(expression, "Identifier") && expression.name === "undefined") return undefined;
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    return undefined;
  }
  return UNKNOWN_STATIC_VALUE;
};

const getAttributeExpression = (attribute: EsTreeNodeOfType<"JSXAttribute">): EsTreeNode | null => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  return stripParenExpression(attribute.value.expression);
};

const isProvenCallableAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = getAttributeExpression(attribute);
  if (!expression) return false;
  if (isFunctionLike(expression)) return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = scopes.symbolFor(expression);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.initializer &&
    isFunctionLike(stripParenExpression(symbol.initializer)),
  );
};

const isPresentChangeHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
): attribute is EsTreeNodeOfType<"JSXAttribute"> =>
  Boolean(attribute && getAttributeStaticValue(attribute) === UNKNOWN_STATIC_VALUE);

const isKnownTruthyHostBoolean = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
): boolean | null => {
  if (!attribute) return false;
  const staticValue = getAttributeStaticValue(attribute);
  return staticValue === UNKNOWN_STATIC_VALUE ? null : Boolean(staticValue);
};

const hasUnresolvedInputHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    attribute &&
    getAttributeStaticValue(attribute) === UNKNOWN_STATIC_VALUE &&
    !isProvenCallableAttribute(attribute, scopes),
  );

const isStaticallyTextEntryInput = (
  typeAttribute: EsTreeNodeOfType<"JSXAttribute"> | null,
): boolean | null => {
  if (!typeAttribute || !typeAttribute.value) return true;
  const staticValue = getAttributeStaticValue(typeAttribute);
  if (staticValue === UNKNOWN_STATIC_VALUE) return null;
  return typeof staticValue !== "string" || !NON_TEXT_INPUT_TYPES.has(staticValue.toLowerCase());
};

export const octaneNoNativeTextOnchange = defineRule({
  id: "octane-no-native-text-onchange",
  title: "React-style text onChange used in Octane",
  severity: "warn",
  recommendation:
    "Use `onInput` for per-edit text updates, or add `suppressNativeChangeWarning` when native commit-on-blur behavior is intentional.",
  matchByOccurrence: true,
  create: (context) => {
    let fileIsOctaneModule = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        const sourceText = context.sourceCode?.getText?.() ?? "";
        fileIsOctaneModule =
          isOctaneModule(node, sourceText) && !NON_DOM_OCTANE_RENDERER_PATTERN.test(sourceText);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!fileIsOctaneModule) return;
        const elementType = resolveJsxElementType(node);
        if (elementType !== "input" && elementType !== "textarea") return;
        if (node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))) {
          return;
        }

        const changeAttributes = [
          findLastAttribute(node.attributes, "onChange"),
          findLastAttribute(node.attributes, "onChangeCapture"),
        ].filter(isPresentChangeHandler);
        if (changeAttributes.length === 0) return;

        const typeAttribute = findLastAttribute(node.attributes, "type");
        if (elementType === "input" && isStaticallyTextEntryInput(typeAttribute) !== true) return;

        const readOnlyAttribute = findLastAttribute(node.attributes, "readOnly", "readonly");
        const disabledAttribute = findLastAttribute(node.attributes, "disabled");
        const suppressionAttribute = findLastAttribute(
          node.attributes,
          "suppressNativeChangeWarning",
        );
        const readOnlyState = isKnownTruthyHostBoolean(readOnlyAttribute);
        const disabledState = isKnownTruthyHostBoolean(disabledAttribute);
        const suppressionState = isKnownTruthyHostBoolean(suppressionAttribute);
        if (readOnlyState === true || disabledState === true || suppressionState === true) return;
        if (readOnlyState === null || disabledState === null || suppressionState === null) return;

        const inputAttributes = [
          findLastAttribute(node.attributes, "onInput"),
          findLastAttribute(node.attributes, "onInputCapture"),
        ];
        if (
          inputAttributes.some(
            (attribute) => attribute && isProvenCallableAttribute(attribute, context.scopes),
          ) ||
          inputAttributes.some((attribute) => hasUnresolvedInputHandler(attribute, context.scopes))
        ) {
          return;
        }

        const firstChangeAttribute = changeAttributes.toSorted(
          (left, right) => getNodeStartIndex(left) - getNodeStartIndex(right),
        )[0];
        if (!firstChangeAttribute) return;
        const changeAttributeName = isNodeOfType(firstChangeAttribute.name, "JSXIdentifier")
          ? firstChangeAttribute.name.name
          : "onChange";
        const replacement =
          changeAttributeName === "onChangeCapture" ? "onInputCapture" : "onInput";
        const hasControlledValue = Boolean(findLastAttribute(node.attributes, "value"));
        context.report({
          node: firstChangeAttribute,
          message: `\`${changeAttributeName}\` is a native commit event in Octane, so it does not run for each text edit. Use \`${replacement}\` for per-edit updates or add \`suppressNativeChangeWarning\` for intentional commit-on-blur behavior.${hasControlledValue ? " This control also has `value`, so use `defaultValue` if commit-only editing should remain uncontrolled." : ""}`,
        });
      },
    };
  },
});
