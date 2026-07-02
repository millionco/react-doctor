import { SMALL_LITERAL_ARRAY_MAX_ELEMENTS } from "../../constants/thresholds.js";
import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// HACK: methods that ALWAYS return a string when called on a string
// receiver. Used to recognize `.toLowerCase().includes(x)` chains as
// string-on-string lookups.
const STRING_RETURNING_METHODS: ReadonlySet<string> = new Set([
  "toString",
  "toLocaleString",
  "toLowerCase",
  "toUpperCase",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "padStart",
  "padEnd",
  "normalize",
  "repeat",
  "replace",
  "replaceAll",
  "substring",
  "substr",
  "charAt",
  "join",
  "toFixed",
  "toExponential",
  "toPrecision",
  "toJSON",
]);

// HACK: DOM/built-in properties whose value is statically `string`.
const STRING_TYPED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "textContent",
  "innerText",
  "innerHTML",
  "outerHTML",
  "nodeValue",
  "nodeName",
  "localName",
  "namespaceURI",
  "baseURI",
  "documentURI",
  "tagName",
  "className",
  "id",
  "lang",
  "dir",
  "title",
  "alt",
  "type",
  "name",
  "placeholder",
  "href",
  "src",
  "value",
  "accessKey",
  "contentEditable",
  "hash",
  "host",
  "hostname",
  "pathname",
  "port",
  "protocol",
  "search",
  "origin",
  "username",
  "password",
  "characterSet",
  "contentType",
  "charset",
  "mimeType",
  "mediaType",
  "cssText",
  "message",
  "stack",
  "fileName",
  "code",
  "label",
  "slug",
  "prefix",
]);

// Identifier suffix conventions whose binding is overwhelmingly a
// string: `*Text` (`spanText`, `labelText`), `*Path` (`lowerPath`,
// `filePath`), `*Url` / `*Uri` / `*Href`, `*Name` (when paired with
// `.includes('literal')`), `*Pattern`, `*Tag`.
const STRING_TYPED_IDENTIFIER_SUFFIXES: ReadonlyArray<string> = [
  "Text",
  "Path",
  "Url",
  "Uri",
  "Href",
  "Pattern",
  "Suffix",
  "Prefix",
  "String",
  "Source",
  "Locale",
  "Codepoint",
  "Char",
  "Word",
  "Markdown",
  "HTML",
  "Html",
  "Css",
  "Xml",
  "Json",
  "Yaml",
  "Sql",
  "Query",
  "Line",
  "Filename",
  "Filepath",
];

const hasStringTypedSuffix = (name: string): boolean => {
  for (const suffix of STRING_TYPED_IDENTIFIER_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return true;
  }
  return false;
};

// HACK: identifier names that overwhelmingly bind to strings.
const STRING_TYPED_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  "text",
  "string",
  "str",
  "content",
  "contents",
  "html",
  "xml",
  "json",
  "css",
  "yaml",
  "markdown",
  "md",
  "source",
  "sourceCode",
  "template",
  "raw",
  "comment",
  "description",
  "summary",
  "snippet",
  "url",
  "uri",
  "path",
  "filename",
  "filepath",
  "fileName",
  "filePath",
  "line",
  "char",
  "character",
  "letter",
  "word",
  "phrase",
  "sentence",
  "paragraph",
  "query",
  "search",
  "pathname",
  "href",
  "hash",
  "haystack",
  "needle",
  // A destructured `for (const [key] of Object.entries(...))` key is a
  // string; `key.includes(sep)` is a substring search (a numeric Map key
  // wouldn't have `.includes` at all), so the Set-rewrite never applies.
  "key",
  // Common string-typed naming conventions in addition to the above
  "suffix",
  "prefix",
  "extension",
  "ext",
  "tableSuffix",
  "tablePrefix",
  "filenameSuffix",
  "filenamePrefix",
  "moduleSuffix",
  "modulePrefix",
  "declaration",
  "expression",
  "statement",
  "literal",
]);

// HACK: returns true when the receiver of `.includes()` / `.indexOf()`
// is obviously a string, so the Set rewrite suggestion doesn't apply.
const isLikelyStringReceiver = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver) return false;
  if (isNodeOfType(receiver, "Literal") && typeof receiver.value === "string") return true;
  if (isNodeOfType(receiver, "TemplateLiteral")) return true;
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "Identifier") &&
    receiver.callee.name === "String"
  ) {
    return true;
  }
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    STRING_RETURNING_METHODS.has(receiver.callee.property.name)
  ) {
    return true;
  }
  if (isNodeOfType(receiver, "MemberExpression") && isNodeOfType(receiver.property, "Identifier")) {
    if (STRING_TYPED_PROPERTY_NAMES.has(receiver.property.name)) return true;
  }
  if (
    isNodeOfType(receiver, "ChainExpression") &&
    receiver.expression &&
    isLikelyStringReceiver(receiver.expression)
  ) {
    return true;
  }
  if (isNodeOfType(receiver, "Identifier")) {
    if (STRING_TYPED_IDENTIFIER_NAMES.has(receiver.name)) return true;
    if (hasStringTypedSuffix(receiver.name)) return true;
  }
  if (isNodeOfType(receiver, "MemberExpression") && isNodeOfType(receiver.property, "Identifier")) {
    if (hasStringTypedSuffix(receiver.property.name)) return true;
  }
  return false;
};

// `lines[i]` / `tokens[cursor]` — indexing into an array by a numeric
// index. The result is the array's element type, which is overwhelmingly
// `string` in the cases that survive after `isLikelyStringReceiver`
// (other element types' membership tests don't even compile without
// the right operand being the same shape). We require the indexer to
// be an index-named Identifier OR a numeric literal so we don't
// accidentally pass through `record[someKey]`.
const INDEX_LIKE_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  "i",
  "j",
  "k",
  "idx",
  "index",
  "cursor",
  "position",
  "pos",
  "lineNumber",
  "lineIndex",
  "ln",
  "row",
  "col",
  "column",
]);

const isIndexedArrayElementWithStringArgument = (
  receiver: EsTreeNode | null | undefined,
  callArgument: EsTreeNode | null | undefined,
): boolean => {
  if (!receiver || !isNodeOfType(receiver, "MemberExpression") || !receiver.computed) {
    return false;
  }
  const property = receiver.property as EsTreeNode;
  const isIndexLike =
    (isNodeOfType(property, "Identifier") && INDEX_LIKE_IDENTIFIER_NAMES.has(property.name)) ||
    (isNodeOfType(property, "Literal") &&
      typeof (property as { value?: unknown }).value === "number");
  if (!isIndexLike) return false;
  // Pair with `.includes("literal-string")` — only skip when the
  // argument is itself a string literal so we don't paper over genuine
  // `arr[i].includes(otherObj)` cases.
  if (!callArgument) return false;
  if (isNodeOfType(callArgument, "Literal") && typeof callArgument.value === "string") {
    return true;
  }
  if (isNodeOfType(callArgument, "TemplateLiteral")) return true;
  return false;
};

// `["admin", "owner"].includes(role)` — an inline literal array small
// enough that a linear scan is trivial. Building a `Set` for a handful of
// constants is pure ceremony, so skip it (same threshold the iteration-
// combination rules use). A named/large array still scans on every loop
// pass, so those stay flagged.
const isSmallInlineLiteralArray = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver || !isNodeOfType(receiver, "ArrayExpression")) return false;
  const elements = receiver.elements ?? [];
  if (elements.length === 0 || elements.length > SMALL_LITERAL_ARRAY_MAX_ELEMENTS) return false;
  return elements.every((element) => element == null || !isNodeOfType(element, "SpreadElement"));
};

// `importClause.includes('{')` — a single-character argument is a
// substring/character search on a string receiver in practice, not an
// array membership test, so the Set rewrite never applies.
const isSingleCharacterStringLiteral = (callArgument: EsTreeNode | null | undefined): boolean => {
  if (!callArgument || !isNodeOfType(callArgument, "Literal")) return false;
  return typeof callArgument.value === "string" && callArgument.value.length === 1;
};

const MEMBERSHIP_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  "===",
  "!==",
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
]);

const isNegativeOneLiteral = (expression: EsTreeNode | null | undefined): boolean =>
  Boolean(expression) &&
  isNodeOfType(expression, "UnaryExpression") &&
  expression.operator === "-" &&
  isNodeOfType(expression.argument, "Literal") &&
  expression.argument.value === 1;

const isZeroLiteral = (expression: EsTreeNode | null | undefined): boolean =>
  Boolean(expression) && isNodeOfType(expression, "Literal") && expression.value === 0;

const PARENT_WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "ParenthesizedExpression",
  "ChainExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
]);

// A `Set` has no `indexOf`, so the rewrite only exists when the result
// is consumed as a membership test (`!== -1`, `>= 0`, `~`-prefixed).
// A result kept as a position (`columnHeights.indexOf(Math.min(...))`)
// has no Set equivalent and must stay silent.
const isIndexOfResultUsedAsMembershipTest = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent && PARENT_WRAPPER_TYPES.has(parent.type)) {
    parent = parent.parent;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "~") return true;
  if (!isNodeOfType(parent, "BinaryExpression")) return false;
  if (!MEMBERSHIP_COMPARISON_OPERATORS.has(parent.operator)) return false;
  const leftOperand = parent.left as EsTreeNode;
  const rightOperand = parent.right as EsTreeNode;
  const otherOperand = stripParenExpression(leftOperand) === node ? rightOperand : leftOperand;
  return isNegativeOneLiteral(otherOperand) || isZeroLiteral(otherOperand);
};

export const jsSetMapLookups = defineRule({
  id: "js-set-map-lookups",
  title: "Array lookup inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use a `Set` or `Map` when you check for the same items over and over. `Array.includes`/`find` scans the whole list each time",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return;
        const methodName = node.callee.property.name;
        if (methodName !== "includes" && methodName !== "indexOf") return;
        if (methodName === "indexOf" && !isIndexOfResultUsedAsMembershipTest(node)) return;
        if (isLikelyStringReceiver(node.callee.object)) return;
        if (isSmallInlineLiteralArray(node.callee.object)) return;
        if (isSingleCharacterStringLiteral(node.arguments?.[0] as EsTreeNode | undefined)) return;
        if (
          isIndexedArrayElementWithStringArgument(
            node.callee.object,
            node.arguments?.[0] as EsTreeNode | undefined,
          )
        ) {
          return;
        }
        context.report({
          node,
          message: `This scales poorly because \`array.${methodName}()\` inside a loop scans the whole list every time. Use a Set for constant-time lookups.`,
        });
      },
    }),
});
