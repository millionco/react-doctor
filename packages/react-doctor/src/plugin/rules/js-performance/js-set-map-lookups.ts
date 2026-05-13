import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
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
]);

// HACK: returns true when the receiver of `.includes()` / `.indexOf()`
// is obviously a string, so the Set rewrite suggestion doesn't apply.
const isLikelyStringReceiver = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver) return false;
  if (receiver.type === "Literal" && typeof receiver.value === "string") return true;
  if (receiver.type === "TemplateLiteral") return true;
  if (
    receiver.type === "CallExpression" &&
    receiver.callee?.type === "Identifier" &&
    receiver.callee.name === "String"
  ) {
    return true;
  }
  if (
    receiver.type === "CallExpression" &&
    receiver.callee?.type === "MemberExpression" &&
    receiver.callee.property?.type === "Identifier" &&
    STRING_RETURNING_METHODS.has(receiver.callee.property.name)
  ) {
    return true;
  }
  if (receiver.type === "MemberExpression" && receiver.property?.type === "Identifier") {
    if (STRING_TYPED_PROPERTY_NAMES.has(receiver.property.name)) return true;
  }
  if (
    receiver.type === "ChainExpression" &&
    receiver.expression &&
    isLikelyStringReceiver(receiver.expression)
  ) {
    return true;
  }
  if (receiver.type === "Identifier" && STRING_TYPED_IDENTIFIER_NAMES.has(receiver.name)) {
    return true;
  }
  return false;
};

export const jsSetMapLookups = defineRule<Rule>({
  recommendation:
    "Use a `Set` or `Map` for repeated membership tests / keyed lookups — `Array.includes`/`find` is O(n) per call",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
          return;
        const methodName = node.callee.property.name;
        if (methodName !== "includes" && methodName !== "indexOf") return;
        if (isLikelyStringReceiver(node.callee.object)) return;
        context.report({
          node,
          message: `array.${methodName}() in a loop is O(n) per call — convert to a Set for O(1) lookups`,
        });
      },
    }),
});
