import { compileGlob } from "../../utils/compile-glob.js";
import { defineRule } from "../../utils/define-rule.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE_NO_LABEL =
  "Blind users can't identify this field because screen readers find no label text, so add visible text, `aria-label`, or `aria-labelledby`.";
const MESSAGE_NO_CONTROL =
  "Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the input inside it.";

interface LabelHasAssociatedControlSettings {
  labelComponents?: ReadonlyArray<string>;
  labelAttributes?: ReadonlyArray<string>;
  controlComponents?: ReadonlyArray<string>;
  assert?: "htmlFor" | "nesting" | "both" | "either";
  depth?: number;
}

interface JsxA11ySettings {
  attributes?: { for?: ReadonlyArray<string> };
}

const DEFAULT_CONTROL_COMPONENTS: ReadonlySet<string> = new Set([
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

const DEFAULT_LABEL_COMPONENTS: ReadonlySet<string> = new Set(["label"]);

const DEFAULT_LABEL_ATTRIBUTES: ReadonlyArray<string> = ["alt", "aria-label", "aria-labelledby"];

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Omit<Required<LabelHasAssociatedControlSettings>, "labelComponents" | "labelAttributes"> & {
  labelComponents: ReadonlySet<string>;
  labelAttributes: ReadonlySet<string>;
  forAttributes: ReadonlyArray<string>;
} => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { labelHasAssociatedControl?: LabelHasAssociatedControlSettings })
          .labelHasAssociatedControl ?? {})
      : {};
  const jsxA11y = settings?.["jsx-a11y"];
  const a11ySettings =
    typeof jsxA11y === "object" && jsxA11y !== null ? (jsxA11y as JsxA11ySettings) : {};
  const forAttributes = a11ySettings.attributes?.for ?? ["htmlFor"];
  const labelComponents: ReadonlySet<string> = new Set([
    ...DEFAULT_LABEL_COMPONENTS,
    ...(ruleSettings.labelComponents ?? []),
  ]);
  const labelAttributes: ReadonlySet<string> = new Set([
    ...DEFAULT_LABEL_ATTRIBUTES,
    ...(ruleSettings.labelAttributes ?? []),
  ]);
  return {
    labelComponents,
    labelAttributes,
    controlComponents: ruleSettings.controlComponents ?? [],
    assert: ruleSettings.assert ?? "either",
    // Default depth: 5 (upstream's default is 2, which is too strict
    // for real React UIs — a routine form-field with semantic
    // structure (`<label><div><div><span>{t('Name')}</span></div></div><input/></label>`)
    // has the input/label-text at depth 3-4 from the label, and
    // design-system inputs frequently wrap the actual <input> in a
    // styled <div>). 5 catches "label has nothing controllable
    // anywhere inside" without false-flagging idiomatic forms.
    depth: Math.min(ruleSettings.depth ?? 5, 25),
    forAttributes,
  };
};

// Custom (uppercase) components whose name marks them as form controls —
// `<SearchableSelect>`, `<Input>`, `<Combobox>` — render a native control
// at runtime; without `controlComponents` configured the static walk
// can't see through them, the doc's documented FP case.
const CONTROL_NAMED_COMPONENT_PATTERN =
  /input|select|textarea|checkbox|radio|switch|slider|combobox|autocomplete|picker|dropdown|toggle/i;

// Glob match used by OXC for `controlComponents` entries (supports `*`).
const isControlComponent = (tagName: string, controlComponents: ReadonlyArray<string>): boolean => {
  if (DEFAULT_CONTROL_COMPONENTS.has(tagName)) return true;
  if (isReactComponentName(tagName) && CONTROL_NAMED_COMPONENT_PATTERN.test(tagName)) return true;
  return controlComponents.some((pattern) => compileGlob(pattern).test(tagName));
};

interface SearchContext {
  depth: number;
  labelAttributes: ReadonlySet<string>;
  controlComponents: ReadonlyArray<string>;
  settings: Readonly<Record<string, unknown>> | undefined;
}

// Identifier / member-property names that plausibly hold renderable
// JSX (`{children}`, `{props.children}`, `{inputElement}`, …). A label
// whose expression child is named like plain text (`{label}`, `{key}`,
// `{t.settings.title}`) provably wraps no control.
const CONTROL_RENDERING_NAME_PATTERN =
  /child|control|input|select|textarea|checkbox|radio|field|element|component|content|widget|render|node|slot/i;

// i18n translation calls return strings, never JSX — `{t("form.name")}`
// inside a label wraps no control.
const I18N_TRANSLATION_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "t",
  "_",
  "__",
  "gettext",
  "formatMessage",
  "translate",
]);

const isTranslationCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) {
    return I18N_TRANSLATION_CALLEE_NAMES.has(callee.name);
  }
  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const property = callee.property as EsTreeNode;
    return isNodeOfType(property, "Identifier") && I18N_TRANSLATION_CALLEE_NAMES.has(property.name);
  }
  return false;
};

// Whether an expression inside a label could evaluate to a form
// control. String-shaped expressions (literals, templates, string
// arithmetic) cannot; unknown calls and renderable-named bindings
// might, so they stay conservative.
const expressionMayRenderControl = (
  rawExpression: EsTreeNode,
  currentDepth: number,
  searchContext: SearchContext,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "JSXEmptyExpression")) return false;
  if (isNodeOfType(expression, "Literal")) return false;
  if (isNodeOfType(expression, "TemplateLiteral")) return false;
  if (isNodeOfType(expression, "BinaryExpression")) return false;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      expressionMayRenderControl(
        expression.consequent as EsTreeNode,
        currentDepth,
        searchContext,
      ) ||
      expressionMayRenderControl(expression.alternate as EsTreeNode, currentDepth, searchContext)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      expressionMayRenderControl(expression.left as EsTreeNode, currentDepth, searchContext) ||
      expressionMayRenderControl(expression.right as EsTreeNode, currentDepth, searchContext)
    );
  }
  if (isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment")) {
    return searchForNestedControl(expression, currentDepth, searchContext);
  }
  if (isNodeOfType(expression, "Identifier")) {
    return CONTROL_RENDERING_NAME_PATTERN.test(expression.name);
  }
  if (isNodeOfType(expression, "MemberExpression")) {
    if (expression.computed) return true;
    const property = expression.property as EsTreeNode;
    if (!isNodeOfType(property, "Identifier")) return true;
    return CONTROL_RENDERING_NAME_PATTERN.test(property.name);
  }
  if (isNodeOfType(expression, "CallExpression")) {
    return !isTranslationCall(expression);
  }
  return true;
};

const searchForNestedControl = (
  child: EsTreeNode,
  currentDepth: number,
  searchContext: SearchContext,
): boolean => {
  if (currentDepth > searchContext.depth) return false;
  if (isNodeOfType(child, "JSXExpressionContainer")) {
    return expressionMayRenderControl(child.expression as EsTreeNode, currentDepth, searchContext);
  }
  if (isNodeOfType(child, "JSXFragment")) {
    return child.children.some((nestedChild) =>
      searchForNestedControl(nestedChild as EsTreeNode, currentDepth + 1, searchContext),
    );
  }
  if (isNodeOfType(child, "JSXElement")) {
    const tagName = getElementType(child.openingElement, searchContext.settings);
    if (isControlComponent(tagName, searchContext.controlComponents)) return true;
    for (const nestedChild of child.children) {
      if (searchForNestedControl(nestedChild as EsTreeNode, currentDepth + 1, searchContext)) {
        return true;
      }
    }
  }
  return false;
};

const searchForAccessibleLabel = (
  child: EsTreeNode,
  currentDepth: number,
  searchContext: SearchContext,
): boolean => {
  if (currentDepth > searchContext.depth) return false;
  if (isNodeOfType(child, "JSXExpressionContainer")) return true;
  if (isNodeOfType(child, "JSXText")) return child.value.trim().length > 0;
  if (isNodeOfType(child, "JSXFragment")) {
    return child.children.some((nestedChild) =>
      searchForAccessibleLabel(nestedChild as EsTreeNode, currentDepth + 1, searchContext),
    );
  }
  if (isNodeOfType(child, "JSXElement")) {
    const opening = child.openingElement;
    for (const attribute of opening.attributes) {
      if (isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute")) return true;
      if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) continue;
      const attributeName = (attribute as EsTreeNodeOfType<"JSXAttribute">).name;
      if (!isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier")) continue;
      const propName = getJsxAttributeName(attributeName as EsTreeNodeOfType<"JSXIdentifier">);
      if (!propName || !searchContext.labelAttributes.has(propName)) continue;
      const attributeValue = (attribute as EsTreeNodeOfType<"JSXAttribute">).value;
      if (!attributeValue) continue;
      if (
        isNodeOfType(attributeValue as EsTreeNode, "Literal") &&
        typeof (attributeValue as EsTreeNodeOfType<"Literal">).value === "string"
      ) {
        if (((attributeValue as EsTreeNodeOfType<"Literal">).value as string).trim().length > 0) {
          return true;
        }
      } else {
        return true;
      }
    }
    if (child.children.length === 0) {
      const tagName = getElementType(opening, searchContext.settings);
      if (
        isReactComponentName(tagName) &&
        !isControlComponent(tagName, searchContext.controlComponents)
      ) {
        return true;
      }
    }
    for (const nestedChild of child.children) {
      if (searchForAccessibleLabel(nestedChild as EsTreeNode, currentDepth + 1, searchContext)) {
        return true;
      }
    }
  }
  return false;
};

const hasAccessibleLabel = (
  element: EsTreeNodeOfType<"JSXElement">,
  searchContext: SearchContext,
): boolean => {
  for (const attribute of element.openingElement.attributes) {
    if (isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute")) return true;
    if (!isNodeOfType(attribute as EsTreeNode, "JSXAttribute")) continue;
    const attributeName = (attribute as EsTreeNodeOfType<"JSXAttribute">).name;
    if (!isNodeOfType(attributeName as EsTreeNode, "JSXIdentifier")) continue;
    const propName = getJsxAttributeName(attributeName as EsTreeNodeOfType<"JSXIdentifier">);
    if (propName && searchContext.labelAttributes.has(propName)) return true;
  }
  for (const child of element.children) {
    if (searchForAccessibleLabel(child as EsTreeNode, 1, searchContext)) return true;
  }
  return false;
};

const hasNestedControl = (
  element: EsTreeNodeOfType<"JSXElement">,
  searchContext: SearchContext,
): boolean => {
  for (const child of element.children) {
    if (searchForNestedControl(child as EsTreeNode, 1, searchContext)) return true;
  }
  return false;
};

// Port of `oxc_linter::rules::jsx_a11y::label_has_associated_control`.
export const labelHasAssociatedControl = defineRule({
  id: "label-has-associated-control",
  title: "Label missing associated control",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Tie every label to a control with `htmlFor`, or by nesting the input.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isTestlikeFile) return;
        const opening = node.openingElement;
        const tagName = getElementType(opening, context.settings);
        if (!settings.labelComponents.has(tagName)) return;
        // A spread on the label itself (`<label {...props}>`) can carry
        // `htmlFor` invisibly — wrapper components like a design-system
        // `<Label>` forward it from callers, the doc's documented FP case.
        const hasSpreadProps = opening.attributes.some((attribute) =>
          isNodeOfType(attribute as EsTreeNode, "JSXSpreadAttribute"),
        );
        // `htmlFor=""` points at no id — it associates nothing, exactly
        // like an absent htmlFor. Dynamic values stay trusted.
        const hasHtmlFor =
          hasSpreadProps ||
          settings.forAttributes.some((attributeName) => {
            const forAttribute = hasJsxPropIgnoreCase(opening.attributes, attributeName);
            if (!forAttribute) return false;
            const stringValue = getJsxPropStringValue(forAttribute);
            return stringValue === null || stringValue.length > 0;
          });
        const searchContext: SearchContext = {
          depth: settings.depth,
          labelAttributes: settings.labelAttributes,
          controlComponents: settings.controlComponents,
          settings: context.settings,
        };
        const hasControl = hasNestedControl(node, searchContext);
        if (!hasAccessibleLabel(node, searchContext)) {
          context.report({ node: opening, message: MESSAGE_NO_LABEL });
          return;
        }
        switch (settings.assert) {
          case "htmlFor":
            if (!hasHtmlFor) context.report({ node: opening, message: MESSAGE_NO_CONTROL });
            return;
          case "nesting":
            if (!hasControl) context.report({ node: opening, message: MESSAGE_NO_CONTROL });
            return;
          case "both":
            if (!hasHtmlFor || !hasControl) {
              context.report({ node: opening, message: MESSAGE_NO_CONTROL });
            }
            return;
          case "either":
          default:
            if (!hasHtmlFor && !hasControl) {
              context.report({ node: opening, message: MESSAGE_NO_CONTROL });
            }
            return;
        }
      },
    };
  },
});
