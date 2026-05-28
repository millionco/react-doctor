import { compileGlob } from "../../utils/compile-glob.js";
import { defineRule } from "../../utils/define-rule.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE_NO_LABEL =
  "A form label must have accessible text — add visible content, `aria-label`, or `aria-labelledby`.";
const MESSAGE_NO_CONTROL =
  "A form label must be associated with a control — use `htmlFor` or nest the input.";

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

const DEFAULT_CONTROL_COMPONENTS: ReadonlyArray<string> = [
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
];

const DEFAULT_LABEL_ATTRIBUTES: ReadonlyArray<string> = ["alt", "aria-label", "aria-labelledby"];

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<LabelHasAssociatedControlSettings> & {
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
  const labelComponents = ["label", ...(ruleSettings.labelComponents ?? [])].sort();
  const labelAttributes = [
    ...new Set([...DEFAULT_LABEL_ATTRIBUTES, ...(ruleSettings.labelAttributes ?? [])]),
  ].sort();
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

// Glob match used by OXC for `controlComponents` entries (supports `*`).
const isControlComponent = (tagName: string, controlComponents: ReadonlyArray<string>): boolean => {
  if (DEFAULT_CONTROL_COMPONENTS.includes(tagName)) return true;
  return controlComponents.some((pattern) => compileGlob(pattern).test(tagName));
};

interface SearchContext {
  depth: number;
  labelAttributes: ReadonlyArray<string>;
  controlComponents: ReadonlyArray<string>;
  settings: Readonly<Record<string, unknown>> | undefined;
}

const searchForNestedControl = (
  child: EsTreeNode,
  currentDepth: number,
  searchContext: SearchContext,
): boolean => {
  if (currentDepth > searchContext.depth) return false;
  if (isNodeOfType(child, "JSXExpressionContainer")) return true;
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
      if (!propName || !searchContext.labelAttributes.includes(propName)) continue;
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
    if (propName && searchContext.labelAttributes.includes(propName)) return true;
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
export const labelHasAssociatedControl = defineRule<Rule>({
  id: "label-has-associated-control",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Associate every label with a control via `htmlFor` or by nesting the input.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isTestlikeFile) return;
        const opening = node.openingElement;
        const tagName = getElementType(opening, context.settings);
        if (!settings.labelComponents.includes(tagName)) return;
        const hasHtmlFor = settings.forAttributes.some((attributeName) =>
          Boolean(hasJsxPropIgnoreCase(opening.attributes, attributeName)),
        );
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
