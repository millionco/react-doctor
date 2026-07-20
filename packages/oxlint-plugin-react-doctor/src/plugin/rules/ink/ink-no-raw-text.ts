import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { collectTextWrapperComponents } from "../../utils/collect-text-wrapper-components.js";
import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { resolveImportedComponentForwarding } from "../../utils/resolve-imported-component-forwarding.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";

const TEXT_COMPONENT_NAMES = new Set(["Text", "Transform"]);

const resolveImportedInkElementName = (
  elementName: string,
  contextNode: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (isNodeOfType(contextNode, "JSXElement")) {
    const directInkElementName = resolveInkJsxElementName(contextNode.openingElement, scopes);
    if (directInkElementName) return directInkElementName;
    const jsxName = contextNode.openingElement.name;
    const bindingIdentifier = isNodeOfType(jsxName, "JSXIdentifier")
      ? jsxName
      : isNodeOfType(jsxName, "JSXMemberExpression") &&
          isNodeOfType(jsxName.object, "JSXIdentifier")
        ? jsxName.object
        : null;
    if (bindingIdentifier && scopes.symbolFor(bindingIdentifier)) return null;
    if (
      isNodeOfType(jsxName, "JSXMemberExpression") &&
      isNodeOfType(jsxName.object, "JSXIdentifier") &&
      isNamespaceImportFromModule(contextNode, jsxName.object.name, "ink")
    ) {
      return jsxName.property.name;
    }
  }
  return getImportedNameFromModule(contextNode, elementName, "ink");
};

const isStaticRawText = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "JSXText")) return Boolean(node.value.trim());
  if (!isNodeOfType(node, "JSXExpressionContainer")) return false;
  const parent = node.parent;
  if (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment")) {
    return false;
  }
  if (!parent.children.some((child) => child === node)) return false;
  if (isNodeOfType(parent, "JSXElement") && node.range[0] < parent.openingElement.range[1]) {
    return false;
  }
  const expression = node.expression;
  return (
    (isNodeOfType(expression, "Literal") &&
      (typeof expression.value === "string" || typeof expression.value === "number")) ||
    (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0)
  );
};

const findRawTextReceiver = (
  node: EsTreeNode,
  context: Parameters<typeof isJsxFragmentElement>[1],
): EsTreeNodeOfType<"JSXElement"> | null => {
  let parentNode = node.parent;
  while (parentNode) {
    if (isNodeOfType(parentNode, "JSXFragment")) {
      parentNode = parentNode.parent;
      continue;
    }
    if (!isNodeOfType(parentNode, "JSXElement")) return null;
    if (isJsxFragmentElement(parentNode.openingElement, context)) {
      parentNode = parentNode.parent;
      continue;
    }
    return parentNode;
  }
  return null;
};

export const inkNoRawText = defineRule({
  id: "ink-no-raw-text",
  title: "Raw text outside Ink Text",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Wrap terminal text in Ink's `<Text>` component.",
  create: (context) => {
    let textWrappers: ReadonlySet<string> = new Set();
    let nonTextWrappers: ReadonlySet<string> = new Set();

    const isTextHandlingRoot = (elementName: string, contextNode: EsTreeNode): boolean => {
      const inkElementName = resolveImportedInkElementName(
        elementName,
        contextNode,
        context.scopes,
      );
      return inkElementName !== null && TEXT_COMPONENT_NAMES.has(inkElementName);
    };
    const isNonTextRoot = (elementName: string, contextNode: EsTreeNode): boolean => {
      const inkElementName = resolveImportedInkElementName(
        elementName,
        contextNode,
        context.scopes,
      );
      return inkElementName !== null && !TEXT_COMPONENT_NAMES.has(inkElementName);
    };
    const resolveImportedForwarding = (
      elementName: string,
      contextNode: EsTreeNode,
    ): "text" | "nonText" | "unknown" => {
      return context.filename
        ? (resolveImportedComponentForwarding(
            contextNode,
            context.scopes,
            context.filename,
            elementName,
            isTextHandlingRoot,
            isNonTextRoot,
          ) ?? "unknown")
        : "unknown";
    };
    const reportRawText = (node: EsTreeNode): void => {
      if (!isStaticRawText(node)) return;
      const receiver = findRawTextReceiver(node, context.scopes);
      if (!receiver) return;
      const directInkElementName = resolveInkJsxElementName(
        receiver.openingElement,
        context.scopes,
      );
      if (directInkElementName && TEXT_COMPONENT_NAMES.has(directInkElementName)) return;
      const elementName = resolveJsxElementName(receiver.openingElement);
      const isProvenNonTextReceiver = Boolean(
        directInkElementName ||
        (elementName &&
          !textWrappers.has(elementName) &&
          (nonTextWrappers.has(elementName) ||
            (isReactComponentName(elementName) &&
              resolveImportedForwarding(elementName, receiver) === "nonText"))),
      );
      if (!isProvenNonTextReceiver) return;
      context.report({
        node,
        message: "Raw text reaches Ink without a `<Text>` boundary.",
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        if (!containsJsxElement(node)) return;
        const childrenForwarding = collectTextWrapperComponents(
          node,
          isTextHandlingRoot,
          isNonTextRoot,
        );
        textWrappers = childrenForwarding.textWrappers;
        nonTextWrappers = childrenForwarding.nonTextWrappers;
      },
      JSXText(node: EsTreeNodeOfType<"JSXText">) {
        reportRawText(node);
      },
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        reportRawText(node);
      },
    };
  },
});
