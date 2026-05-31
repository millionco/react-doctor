import {
  RAW_TEXT_PREVIEW_MAX_CHARS,
  REACT_NATIVE_TEXT_COMPONENTS,
  REACT_NATIVE_TEXT_COMPONENT_KEYWORDS,
  REACT_NATIVE_TEXT_TRANSPARENT_COMPONENTS,
} from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsidePlatformOsWebBranch } from "../../utils/is-inside-platform-os-web-branch.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";

const TEXT_WRAPPER_HOC_NAMES = new Set(["memo", "forwardRef"]);

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

const isReactComponentWrapperCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) return TEXT_WRAPPER_HOC_NAMES.has(callee.name);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (callee.computed || !isNodeOfType(callee.property, "Identifier")) return false;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "React") return false;
  return TEXT_WRAPPER_HOC_NAMES.has(callee.property.name);
};

const resolveComponentFunction = (
  node: EsTreeNode | null,
):
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | null => {
  if (!node) return null;
  const expression = stripParenExpression(node);
  if (isFunctionLike(expression)) return expression;
  if (!isNodeOfType(expression, "CallExpression") || !isReactComponentWrapperCall(expression)) {
    return null;
  }
  const firstArgument = expression.arguments[0];
  return firstArgument ? resolveComponentFunction(firstArgument as EsTreeNode) : null;
};

const collectRenderReturnExpressions = (
  functionNode:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">,
): EsTreeNode[] => {
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return [functionNode.body];
  }

  if (!functionNode.body) return [];

  const returnExpressions: EsTreeNode[] = [];
  walkAst(functionNode.body, (node) => {
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      returnExpressions.push(node.argument);
    }
  });

  return returnExpressions;
};

const isNullableRenderExpression = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal"))
    return expression.value === null || expression.value === false;
  return isNodeOfType(expression, "Identifier") && expression.name === "undefined";
};

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
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "Wrap text in a `<Text>` component: `<Text>{value}</Text>` — raw strings outside `<Text>` crash on React Native",
  triage: {
    why: "React Native only permits strings inside text-rendering components.",
    impact: "This is a user-visible crash risk, not a style preference.",
    effort: "low",
    confidence: "high",
  },
  create: (context: RuleContext) => {
    // The package-boundary gate (`isReactNativeFileActive`) lives on the
    // rule wrapper applied at registry load — by the time we get here
    // the file is confirmed to belong to a React Native / Expo package
    // (or to be ambiguous enough that we err on the side of running).
    // The only file-level branch we still need is "use dom", which is
    // Expo Router's directive that opts a single file into being rendered
    // in a WebView as DOM rather than on React Native primitives.
    let isDomComponentFile = false;
    const textWrapperCache = new Map<number, boolean>();

    const isLocalTextWrapperComponent = (
      symbol: SymbolDescriptor,
      seenSymbols: Set<number>,
    ): boolean => {
      const cachedResult = textWrapperCache.get(symbol.id);
      if (cachedResult !== undefined) return cachedResult;
      if (seenSymbols.has(symbol.id)) return false;

      const functionNode = resolveComponentFunction(symbol.initializer);
      if (!functionNode) {
        textWrapperCache.set(symbol.id, false);
        return false;
      }

      seenSymbols.add(symbol.id);
      const returnExpressions = collectRenderReturnExpressions(functionNode);
      const isTextWrapper =
        returnExpressions.length > 0 &&
        returnExpressions.every(
          (expression) =>
            isNullableRenderExpression(expression) ||
            isTextBoundaryExpression(expression, seenSymbols),
        );
      seenSymbols.delete(symbol.id);
      textWrapperCache.set(symbol.id, isTextWrapper);
      return isTextWrapper;
    };

    const isTextBoundaryElement = (
      node: EsTreeNodeOfType<"JSXElement">,
      seenSymbols: Set<number>,
    ): boolean => {
      const elementName = resolveTextBoundaryName(node.openingElement);
      if (elementName && isTextHandlingComponent(elementName)) return true;
      const nameNode = node.openingElement.name;
      if (!isNodeOfType(nameNode, "JSXIdentifier")) return false;
      const symbol = context.scopes.symbolFor(nameNode);
      return symbol ? isLocalTextWrapperComponent(symbol, seenSymbols) : false;
    };

    const isTextBoundaryExpression = (node: EsTreeNode, seenSymbols: Set<number>): boolean => {
      const expression = stripParenExpression(node);
      if (isNodeOfType(expression, "JSXElement")) {
        return isTextBoundaryElement(expression, seenSymbols);
      }
      if (isNodeOfType(expression, "ConditionalExpression")) {
        return (
          (isNullableRenderExpression(expression.consequent) ||
            isTextBoundaryExpression(expression.consequent, seenSymbols)) &&
          (isNullableRenderExpression(expression.alternate) ||
            isTextBoundaryExpression(expression.alternate, seenSymbols))
        );
      }
      if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
        return (
          isNullableRenderExpression(expression.right) ||
          isTextBoundaryExpression(expression.right, seenSymbols)
        );
      }
      return false;
    };

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        isDomComponentFile = hasDirective(programNode, "use dom");
      },
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (isDomComponentFile) return;

        const elementName = resolveTextBoundaryName(node.openingElement);
        if (elementName && isTextHandlingComponent(elementName)) return;
        if (isTextBoundaryElement(node, new Set())) return;

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
            message: `Raw ${getRawTextDescription(child)} outside a <Text> component — this will crash on React Native`,
          });
        }
      },
    };
  },
});
