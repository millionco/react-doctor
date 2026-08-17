import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const INPUT_GROUP_MODULE_PATTERN =
  /(?:^|\/)ui\/(?:.*\/)?input-group$|^\.\.?\/(?:.*\/)?input-group$/;
const CANONICAL_INPUT_GROUP_PARTS: ReadonlySet<string> = new Set([
  "InputGroupAddon",
  "InputGroupInput",
  "InputGroupTextarea",
]);

interface RawControlContract {
  readonly uiComponent: string;
  readonly uiModuleSourcePattern: RegExp;
  readonly nativeTag: string;
  readonly replacement: string;
}

// InputGroup owns the group's border, focus ring, and error ring through its
// `data-slot="input-group-control"` child selectors. A raw control dropped
// directly inside keeps its own border and focus ring, so the group renders
// a control-inside-a-control double frame and the group ring never activates.
const RAW_CONTROL_CONTRACTS: ReadonlyArray<RawControlContract> = [
  {
    uiComponent: "Input",
    uiModuleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?input$|^\.\.?\/(?:.*\/)?input$/,
    nativeTag: "input",
    replacement: "InputGroupInput",
  },
  {
    uiComponent: "Textarea",
    uiModuleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?textarea$|^\.\.?\/(?:.*\/)?textarea$/,
    nativeTag: "textarea",
    replacement: "InputGroupTextarea",
  },
  {
    uiComponent: "Button",
    uiModuleSourcePattern: /(?:^|\/)ui\/(?:.*\/)?button$|^\.\.?\/(?:.*\/)?button$/,
    nativeTag: "button",
    replacement: "InputGroupButton inside an InputGroupAddon",
  },
];

const collectDirectRenderedElements = (
  children: ReadonlyArray<EsTreeNode>,
  elements: Array<EsTreeNodeOfType<"JSXElement">>,
): void => {
  for (const child of children) {
    if (isNodeOfType(child, "JSXElement")) {
      elements.push(child);
    } else if (isNodeOfType(child, "JSXFragment")) {
      collectDirectRenderedElements(child.children, elements);
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      collectDirectRenderedExpressionElements(child.expression, elements);
    }
  }
};

// Follows rendering structure (fragments, conditionals, logical guards,
// arrays) without crossing into another element's children — a control
// nested inside an InputGroupAddon is that part's concern, not the group's.
const collectDirectRenderedExpressionElements = (
  rawExpression: EsTreeNode,
  elements: Array<EsTreeNodeOfType<"JSXElement">>,
): void => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "JSXElement")) {
    elements.push(expression);
    return;
  }
  if (isNodeOfType(expression, "JSXFragment")) {
    collectDirectRenderedElements(expression.children, elements);
    return;
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    collectDirectRenderedExpressionElements(expression.consequent, elements);
    collectDirectRenderedExpressionElements(expression.alternate, elements);
    return;
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    collectDirectRenderedExpressionElements(expression.right, elements);
    if (expression.operator !== "&&") {
      collectDirectRenderedExpressionElements(expression.left, elements);
    }
    return;
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    for (const element of expression.elements) {
      if (element && !isNodeOfType(element, "SpreadElement")) {
        collectDirectRenderedExpressionElements(element, elements);
      }
    }
  }
};

const getRawControlContract = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): RawControlContract | null => {
  const flattenedName = flattenJsxName(openingElement.name);
  for (const contract of RAW_CONTROL_CONTRACTS) {
    if (
      flattenedName === contract.nativeTag ||
      resolveShadcnUiComponentName(openingElement.name, contract.uiModuleSourcePattern, context) ===
        contract.uiComponent
    ) {
      return contract;
    }
  }
  return null;
};

const isCanonicalInputGroupPart = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const componentName = resolveShadcnUiComponentName(
    openingElement.name,
    INPUT_GROUP_MODULE_PATTERN,
    context,
  );
  return componentName !== null && CANONICAL_INPUT_GROUP_PARTS.has(componentName);
};

// A hidden input renders nothing, so it cannot double-frame the group.
const isHiddenInput = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const typeAttribute = findJsxAttribute(openingElement.attributes, "type");
  return typeAttribute !== undefined && getJsxPropStringValue(typeAttribute) === "hidden";
};

export const shadcnInputGroupNoRawControls = defineRule({
  id: "shadcn-input-group-no-raw-controls",
  title: "Raw control directly inside InputGroup",
  severity: "warn",
  category: "Correctness",
  requires: ["shadcn"],
  matchByOccurrence: true,
  recommendation:
    "Compose InputGroup from its own parts (InputGroupInput, InputGroupTextarea, and InputGroupAddon with InputGroupButton) so the group owns one border, focus ring, and error state.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        resolveShadcnUiComponentName(node.name, INPUT_GROUP_MODULE_PATTERN, context) !==
        "InputGroup"
      ) {
        return;
      }
      const groupElement = node.parent;
      if (!groupElement || !isNodeOfType(groupElement, "JSXElement")) return;
      const directChildElements: Array<EsTreeNodeOfType<"JSXElement">> = [];
      collectDirectRenderedElements(groupElement.children, directChildElements);
      if (
        !directChildElements.some((childElement) =>
          isCanonicalInputGroupPart(childElement.openingElement, context),
        )
      ) {
        return;
      }
      for (const childElement of directChildElements) {
        const contract = getRawControlContract(childElement.openingElement, context);
        if (!contract || isHiddenInput(childElement.openingElement)) continue;
        const childName = flattenJsxName(childElement.openingElement.name) ?? contract.nativeTag;
        context.report({
          node: childElement.openingElement,
          message: `This ${childName} sits directly inside InputGroup, so it keeps its own border and focus ring and the group's shared focus and error styling never applies. Use ${contract.replacement} instead.`,
        });
      }
    },
  }),
});
