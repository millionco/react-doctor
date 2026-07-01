import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const SLICE_METHOD_NAMES = new Set(["substring", "slice"]);
const OPEN_BRACKETS = new Set(["{", "["]);
const CLOSE_BRACKET_FOR_OPEN = new Map([
  ["{", "}"],
  ["[", "]"],
]);

// The source-variable names that mark free-form / LLM / CLI output, where
// the first-open/last-close invariant does not hold.
const FREE_FORM_SOURCE_NAME_PATTERN =
  /raw|output|text|response|completion|content/i;

const getStringLiteralValue = (
  node: EsTreeNode | null | undefined
): string | null => {
  if (!node) return null;
  const stripped = stripParenExpression(node);
  return isNodeOfType(stripped, "Literal") && typeof stripped.value === "string"
    ? stripped.value
    : null;
};

// Peels one identifier binding so `const firstOpen = str.indexOf('{')` /
// `const lastClose = str.lastIndexOf('}')` resolve to their originating call.
const resolveOneBindingLevel = (node: EsTreeNode): EsTreeNode => {
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Identifier")) {
    const binding = findVariableInitializer(stripped, stripped.name);
    if (binding?.initializer) return stripParenExpression(binding.initializer);
  }
  return stripped;
};

const getMemberCallSearchChar = (
  node: EsTreeNode,
  methodName: string
): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== methodName
  ) {
    return null;
  }
  return getStringLiteralValue(node.arguments?.[0]);
};

const getFirstOpenBracket = (startNode: EsTreeNode): string | null => {
  const char = getMemberCallSearchChar(
    resolveOneBindingLevel(startNode),
    "indexOf"
  );
  return char && OPEN_BRACKETS.has(char) ? char : null;
};

const getLastCloseBracket = (endNode: EsTreeNode): string | null => {
  let target = stripParenExpression(endNode);
  // `lastIndexOf('}') + 1`: descend to the lastIndexOf side of the offset.
  if (isNodeOfType(target, "BinaryExpression") && target.operator === "+") {
    target = target.left as EsTreeNode;
  }
  const char = getMemberCallSearchChar(
    resolveOneBindingLevel(target),
    "lastIndexOf"
  );
  return char === "}" || char === "]" ? char : null;
};

const isJsonParseCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "JSON" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "parse"
  );
};

const getEnclosingSearchRoot = (node: EsTreeNode): EsTreeNode => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  let topmost: EsTreeNode = node;
  while (cursor) {
    if (isFunctionLike(cursor)) return cursor;
    topmost = cursor;
    cursor = cursor.parent;
  }
  return topmost;
};

const sliceIsFedToJsonParse = (
  sliceCall: EsTreeNode,
  searchRoot: EsTreeNode
): boolean => {
  const parent = sliceCall.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression") && isJsonParseCall(parent))
    return true;
  if (isNodeOfType(parent, "ReturnStatement") && parent.argument === sliceCall)
    return true;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === sliceCall &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    const variableName = parent.id.name;
    let feeds = false;
    walkAst(searchRoot, (child: EsTreeNode) => {
      if (!isJsonParseCall(child) || !isNodeOfType(child, "CallExpression"))
        return;
      const argument = child.arguments?.[0];
      if (
        argument &&
        isNodeOfType(argument, "Identifier") &&
        argument.name === variableName
      ) {
        feeds = true;
      }
    });
    return feeds;
  }
  return false;
};

const literalMentionsCodeFence = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Literal")) {
    const raw = node.raw;
    if (typeof raw === "string" && raw.includes("```")) return true;
    return typeof node.value === "string" && node.value.includes("```");
  }
  if (isNodeOfType(node, "TemplateElement")) {
    return (
      typeof node.value?.raw === "string" && node.value.raw.includes("```")
    );
  }
  return false;
};

const hasFreeFormSignal = (
  sliceCall: EsTreeNode,
  searchRoot: EsTreeNode,
  sourceName: string | null
): boolean => {
  if (sourceName && FREE_FORM_SOURCE_NAME_PATTERN.test(sourceName)) return true;
  let signal = false;
  walkAst(searchRoot, (child: EsTreeNode) => {
    if (literalMentionsCodeFence(child)) signal = true;
    // A prior `JSON.parse` wrapped in try/catch with this slice as the
    // fallback extraction is the tell-tale free-form provenance.
    if (isNodeOfType(child, "TryStatement")) {
      let tryBlockParsesJson = false;
      walkAst(child.block, (inner: EsTreeNode) => {
        if (isJsonParseCall(inner)) tryBlockParsesJson = true;
      });
      if (tryBlockParsesJson) signal = true;
    }
  });
  return signal;
};

export const noGreedyFirstOpenLastCloseJsonExtract = defineRule({
  id: "no-greedy-first-open-last-close-json-extract",
  title: "Greedy first-open last-close JSON extraction",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Slicing from `indexOf('{')` to `lastIndexOf('}') + 1` assumes exactly one balanced object with no stray braces, which breaks on free-form model/CLI output with multiple objects or braces in prose. Use a depth-counted bracket scan that matches the closer balancing the first opener.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (!isNodeOfType(callee.property, "Identifier")) return;
      if (!SLICE_METHOD_NAMES.has(callee.property.name)) return;
      const args = node.arguments ?? [];
      if (args.length < 2 || !args[0] || !args[1]) return;

      const openBracket = getFirstOpenBracket(args[0]);
      if (!openBracket) return;
      const closeBracket = getLastCloseBracket(args[1]);
      if (
        !closeBracket ||
        CLOSE_BRACKET_FOR_OPEN.get(openBracket) !== closeBracket
      )
        return;

      const searchRoot = getEnclosingSearchRoot(node);
      if (!sliceIsFedToJsonParse(node, searchRoot)) return;

      const sourceName = isNodeOfType(callee.object, "Identifier")
        ? callee.object.name
        : null;
      if (!hasFreeFormSignal(node, searchRoot, sourceName)) return;

      context.report({
        node,
        message:
          "This extracts JSON by slicing from the first opening bracket to the last closing bracket, which swallows stray braces and extra objects in free-form output and yields malformed JSON. Use a depth-counted bracket scan instead.",
      });
    },
  }),
});
