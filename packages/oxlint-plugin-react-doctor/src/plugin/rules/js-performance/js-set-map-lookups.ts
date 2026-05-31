import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

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
  "haystack",
  "needle",
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

export const jsSetMapLookups = defineRule<Rule>({
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
        if (isLikelyStringReceiver(node.callee.object)) return;
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
          message: `This gets slow because array.${methodName}() inside a loop scans the whole list every time, so use a Set for instant lookups`,
        });
      },
    }),
});
