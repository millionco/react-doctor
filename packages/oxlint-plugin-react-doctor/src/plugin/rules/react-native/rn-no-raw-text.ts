import {
  RAW_TEXT_PREVIEW_MAX_CHARS,
  REACT_NATIVE_TEXT_COMPONENTS,
  REACT_NATIVE_TEXT_COMPONENT_KEYWORDS,
  REACT_NATIVE_TEXT_TRANSPARENT_COMPONENTS,
} from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isInsidePlatformOsWebBranch } from "../../utils/is-inside-platform-os-web-branch.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { collectTextWrapperComponents } from "./utils/collect-text-wrapper-components.js";
import { isExpoUiComponentElement } from "./utils/is-expo-ui-component-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const truncateText = (text: string): string =>
  text.length > RAW_TEXT_PREVIEW_MAX_CHARS
    ? `${text.slice(0, RAW_TEXT_PREVIEW_MAX_CHARS)}...`
    : text;

const isRawTextContent = (child: EsTreeNode): boolean => {
  if (isNodeOfType(child, "JSXText")) return Boolean(child.value?.trim());
  if (!isNodeOfType(child, "JSXExpressionContainer") || !child.expression) return false;

  const expression = child.expression;
  return (
    (isNodeOfType(expression, "Literal") &&
      (typeof expression.value === "string" || typeof expression.value === "number")) ||
    isNodeOfType(expression, "TemplateLiteral")
  );
};

const getRawTextDescription = (child: EsTreeNode): string => {
  if (isNodeOfType(child, "JSXText")) {
    return `"${truncateText(child.value.trim())}"`;
  }

  if (isNodeOfType(child, "JSXExpressionContainer") && child.expression) {
    const expression = child.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return `"${truncateText(expression.value)}"`;
    }
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "number") {
      return `{${expression.value}}`;
    }
    if (isNodeOfType(expression, "TemplateLiteral")) return "template literal";
  }

  return "text content";
};

// Resolves the tag name used for the text-boundary checks. Namespaced JSX tags
// (fbtee's <fbt:param>, <fbt:plural>, …) resolve to their namespace (`fbt`) so
// they inherit the transparency of the <fbt> construct they belong to.
const resolveTextBoundaryName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  if (isNodeOfType(openingElement.name, "JSXNamespacedName")) {
    return openingElement.name.namespace.name;
  }
  return resolveJsxElementName(openingElement);
};

const isTextHandlingComponent = (elementName: string): boolean => {
  if (REACT_NATIVE_TEXT_COMPONENTS.has(elementName)) return true;
  return [...REACT_NATIVE_TEXT_COMPONENT_KEYWORDS].some((keyword) => elementName.includes(keyword));
};

const isTransparentTextWrapper = (elementName: string | null): boolean =>
  elementName !== null && REACT_NATIVE_TEXT_TRANSPARENT_COMPONENTS.has(elementName);

// Walks ancestors to a real text component, stepping through transparent
// wrappers. Returns false as soon as a non-transparent, non-text element
// breaks the chain — so the text boundary is only honored when every link
// up to the <Text> is itself transparent.
const isInsideTextHandlingComponent = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  let parentNode = node.parent;
  while (parentNode) {
    if (!isNodeOfType(parentNode, "JSXElement")) {
      parentNode = parentNode.parent;
      continue;
    }
    const parentName = resolveTextBoundaryName(parentNode.openingElement);
    if (parentName && isTextHandlingComponent(parentName)) return true;
    if (!isTransparentTextWrapper(parentName)) return false;
    parentNode = parentNode.parent;
  }
  return false;
};

export const rnNoRawText = defineRule<Rule>({
  id: "rn-no-raw-text",
  title: "Raw text outside a Text component",
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "Text outside a `<Text>` component crashes on React Native. Wrap it like `<Text>{value}</Text>`.",
  create: (context: RuleContext) => {
    // The package-boundary gate (`isReactNativeFileActive`) lives on the
    // rule wrapper applied at registry load — by the time we get here
    // the file is confirmed to belong to a React Native / Expo package
    // (or to be ambiguous enough that we err on the side of running).
    // The only file-level branch we still need is "use dom", which is
    // Expo Router's directive that opts a single file into being rendered
    // in a WebView as DOM rather than on React Native primitives.
    let isDomComponentFile = false;

    // Auto-detected in-file text wrappers — components whose returned root is
    // a real `<Text>` (so they forward children into text). Populated from the
    // program on first visit so usage anywhere in the file (declared before or
    // after) is seen. Manual `textComponents` / `rawTextWrapperComponents`
    // overrides are applied separately in the core diagnostic pipeline
    // (config-driven), so a project can name cross-file wrappers this
    // single-file pass can't see.
    let autoDetectedWrappers: ReadonlySet<string> = new Set();

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        isDomComponentFile = hasDirective(programNode, "use dom");
        autoDetectedWrappers = collectTextWrapperComponents(programNode, isTextHandlingComponent);
      },
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isDomComponentFile) return;

        const elementName = resolveTextBoundaryName(node.openingElement);

        // A real text component (name heuristic) or an in-file forwarder we
        // verified renders into a `<Text>` root renders its children inside
        // text — so raw text passed to it is safe, INCLUDING mixed children
        // (`<Banner><Icon/> hi</Banner>`), because the `<Text>` root wraps
        // whatever children it receives. The string-only contract only applies
        // to config-named `rawTextWrapperComponents` (handled in core), where
        // we can't see the implementation.
        if (
          elementName &&
          (isTextHandlingComponent(elementName) || autoDetectedWrappers.has(elementName))
        ) {
          return;
        }

        // Universal UI (`@expo/ui`) `<ListItem>` and its compound slot
        // markers render raw string children inside native text areas, so
        // string children are safe. Resolved via the import (not the name
        // heuristic) since `ListItem` is a common name in other libraries.
        if (isExpoUiComponentElement(node.openingElement, node, "ListItem")) return;

        // `Platform.OS === "web"` branches deliberately render web markup
        // (raw text, div/span trees, etc.) when the app is bundled by
        // react-native-web. Skipping the JSX subtree here mirrors the
        // package-level boundary handled by the wrapper — same rationale,
        // narrower scope.
        if (isInsidePlatformOsWebBranch(node)) return;

        if (isTransparentTextWrapper(elementName) && isInsideTextHandlingComponent(node)) {
          return;
        }

        for (const child of node.children ?? []) {
          if (!isRawTextContent(child)) continue;

          context.report({
            node: child,
            message: `Your users hit a crash when raw ${getRawTextDescription(child)} renders outside a <Text> component on React Native.`,
          });
        }
      },
    };
  },
});
