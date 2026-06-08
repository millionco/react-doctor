import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const UNNECESSARY_BRACES_MESSAGE =
  "These curly braces wrap a literal value, so they add JSX noise without changing output.";
const REQUIRED_BRACES_MESSAGE =
  "This JSX value needs `{ }` so React reads it as an expression instead of text.";

type AllowedMode = "always" | "never" | "ignore";

interface JsxCurlyBracePresenceSettings {
  props?: AllowedMode;
  children?: AllowedMode;
  propElementValues?: AllowedMode;
}

const isAllowedMode = (value: unknown): value is AllowedMode =>
  value === "always" || value === "never" || value === "ignore";

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxCurlyBracePresenceSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettingsRaw =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? (reactDoctor as { jsxCurlyBracePresence?: unknown }).jsxCurlyBracePresence
      : undefined;
  // Top-level "always"/"never"/"ignore" string sets all three modes.
  if (isAllowedMode(ruleSettingsRaw)) {
    return {
      props: ruleSettingsRaw,
      children: ruleSettingsRaw,
      propElementValues: ruleSettingsRaw,
    };
  }
  const ruleSettings: JsxCurlyBracePresenceSettings =
    typeof ruleSettingsRaw === "object" && ruleSettingsRaw !== null
      ? (ruleSettingsRaw as JsxCurlyBracePresenceSettings)
      : {};
  return {
    props: ruleSettings.props ?? "never",
    children: ruleSettings.children ?? "never",
    propElementValues: ruleSettings.propElementValues ?? "ignore",
  };
};

// Helpers ported from `oxc_linter::rules::react::jsx_curly_brace_presence`.

const HTML_ENTITY_REGEX = /(&[A-Za-z\d#]+;)/;
const HTML_ENTITY_GLOBAL_REGEX = /(&[A-Za-z\d#]+;)/g;
const isWhitespaceOnly = (text: string): boolean => text.length > 0 && /^\s+$/.test(text);
const containsLineBreak = (text: string): boolean => /[\n\r]/.test(text);
const containsLineBreakLiteral = (text: string): boolean => /\\[nr]/.test(text);
const containsDisallowedJsxTextChars = (text: string): boolean => /[<>{}\\]/.test(text);
const containsMultilineComment = (text: string): boolean =>
  text.includes("/*") || text.includes("*/");
const containsHtmlEntity = (text: string): boolean => HTML_ENTITY_REGEX.test(text);
const containsOnlyHtmlEntities = (text: string): boolean =>
  text.replace(HTML_ENTITY_GLOBAL_REGEX, "").trim().length === 0;
const containsUtf8Escape = (text: string): boolean => /\\u/.test(text);
const containsBothQuotes = (text: string): boolean => text.includes('"') && text.includes("'");
const containsAnyQuote = (text: string): boolean => /["']/.test(text);

const hasAdjacentExpressionContainerSibling = (
  container: EsTreeNodeOfType<"JSXExpressionContainer">,
): boolean => {
  const parent = (container as EsTreeNode).parent;
  if (!parent) return false;
  if (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment")) {
    return false;
  }
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    if ((children[index] as EsTreeNode) !== (container as EsTreeNode)) continue;
    const previous = children[index - 1];
    const next = children[index + 1];
    if (previous && isNodeOfType(previous as EsTreeNode, "JSXExpressionContainer")) {
      return true;
    }
    if (next && isNodeOfType(next as EsTreeNode, "JSXExpressionContainer")) return true;
    return false;
  }
  return false;
};

const isAllowedStringLikeInContainer = (
  text: string,
  container: EsTreeNodeOfType<"JSXExpressionContainer">,
  isProp: boolean,
): boolean =>
  isWhitespaceOnly(text) ||
  containsLineBreak(text) ||
  containsHtmlEntity(text) ||
  (isProp && containsBothQuotes(text)) ||
  (!isProp && containsDisallowedJsxTextChars(text)) ||
  (!isProp && text.trim() !== text) ||
  containsMultilineComment(text) ||
  containsLineBreakLiteral(text) ||
  containsUtf8Escape(text) ||
  hasAdjacentExpressionContainerSibling(container);

// Helper: extracts the no-substitution template's cooked value if the
// expression is a single-quasi template literal; else null.
const singleQuasiTemplateValue = (expression: EsTreeNode): string | null => {
  if (!isNodeOfType(expression, "TemplateLiteral")) return null;
  return getStaticTemplateLiteralValue(expression);
};

const checkExpressionContainer = (
  container: EsTreeNodeOfType<"JSXExpressionContainer">,
  parentIsAttribute: boolean,
  context: Parameters<Rule["create"]>[0],
  settings: Required<JsxCurlyBracePresenceSettings>,
): void => {
  const expression = container.expression as EsTreeNode;
  if (expression.type === "JSXEmptyExpression") return;
  const allowed = parentIsAttribute ? settings.props : settings.children;

  if (isNodeOfType(expression, "JSXFragment")) {
    if (
      !parentIsAttribute &&
      settings.children === "never" &&
      !hasAdjacentExpressionContainerSibling(container)
    ) {
      context.report({ node: container, message: UNNECESSARY_BRACES_MESSAGE });
    }
    return;
  }
  if (isNodeOfType(expression, "JSXElement")) {
    if (parentIsAttribute) {
      if (settings.propElementValues === "never" && !expression.closingElement) {
        context.report({ node: container, message: UNNECESSARY_BRACES_MESSAGE });
      }
    } else if (settings.children === "never" && !hasAdjacentExpressionContainerSibling(container)) {
      context.report({ node: container, message: UNNECESSARY_BRACES_MESSAGE });
    }
    return;
  }
  if (
    isNodeOfType(expression, "Literal") &&
    typeof expression.value === "string" &&
    allowed === "never"
  ) {
    // Use the raw source (without surrounding quotes) to preserve
    // escape sequences and other characters OXC inspects.
    const rawWithQuotes = (expression as { raw?: string }).raw;
    const innerSource =
      typeof rawWithQuotes === "string" && rawWithQuotes.length >= 2
        ? rawWithQuotes.slice(1, -1)
        : expression.value;
    if (isAllowedStringLikeInContainer(innerSource, container, parentIsAttribute)) return;
    context.report({ node: container, message: UNNECESSARY_BRACES_MESSAGE });
    return;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && allowed === "never") {
    const cooked = getStaticTemplateLiteralValue(expression);
    if (cooked === null) return;
    const rawSource = expression.quasis?.[0]?.value.raw ?? "";
    if (!parentIsAttribute && containsAnyQuote(cooked)) return;
    if (isAllowedStringLikeInContainer(rawSource, container, parentIsAttribute)) return;
    context.report({ node: container, message: UNNECESSARY_BRACES_MESSAGE });
  }
  // Suppress unused-name warning for helper used in older code path.
  void singleQuasiTemplateValue;
};

const isScriptElement = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  isNodeOfType(openingElement.name as EsTreeNode, "JSXIdentifier") &&
  (openingElement.name as EsTreeNodeOfType<"JSXIdentifier">).name === "script";

// Port of `oxc_linter::rules::react::jsx_curly_brace_presence`.
export const jsxCurlyBracePresence = defineRule<Rule>({
  id: "jsx-curly-brace-presence",
  title: "Unnecessary curly braces in JSX",
  severity: "warn",
  // Pure stylistic rule — `{'string'}` vs `"string"` is a formatter
  // concern, not a bug class. Default off.
  defaultEnabled: false,
  recommendation:
    "Use one JSX literal style so equivalent markup scans the same without extra JSX noise.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const value = node.value as EsTreeNode | null;
        if (!value) return;
        if (isNodeOfType(value, "JSXExpressionContainer")) {
          checkExpressionContainer(value, true, context, settings);
          return;
        }
        if (isNodeOfType(value, "JSXElement") || isNodeOfType(value, "JSXFragment")) {
          if (settings.propElementValues === "always") {
            context.report({ node: value, message: REQUIRED_BRACES_MESSAGE });
          }
          return;
        }
        if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
          if (settings.props === "always") {
            context.report({ node: value, message: REQUIRED_BRACES_MESSAGE });
          }
        }
      },
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        const parent = (node as EsTreeNode).parent;
        if (!parent) return;
        if (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment")) return;
        // Skip script-tag children — escapes / unbalanced braces are
        // legitimate and should not be flagged.
        if (
          isNodeOfType(parent, "JSXElement") &&
          settings.children === "never" &&
          isScriptElement(parent.openingElement)
        ) {
          return;
        }
        checkExpressionContainer(node, false, context, settings);
      },
      JSXText(node: EsTreeNodeOfType<"JSXText">) {
        if (settings.children !== "always") return;
        const text = node.value;
        if (containsOnlyHtmlEntities(text)) return;
        if (isWhitespaceOnly(text)) return;
        if (text.trim().length === 0) return;
        context.report({ node, message: REQUIRED_BRACES_MESSAGE });
      },
    };
  },
});
