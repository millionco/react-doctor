import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// Static property name of a member access (`a.b` / `a["b"]`), or null for a
// dynamic computed access (`a[key]`).
const getStaticMemberPropertyName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const unwrapped = stripParenExpression(node);
  if (!isNodeOfType(unwrapped, "MemberExpression")) return null;
  if (!unwrapped.computed && isNodeOfType(unwrapped.property, "Identifier")) {
    return unwrapped.property.name;
  }
  if (
    unwrapped.computed &&
    isNodeOfType(unwrapped.property, "Literal") &&
    typeof unwrapped.property.value === "string"
  ) {
    return unwrapped.property.value;
  }
  return null;
};

const someNodeInSubtree = (root: EsTreeNode, predicate: (node: EsTreeNode) => boolean): boolean => {
  if (predicate(root)) return true;
  const rootRecord = root as unknown as Record<string, unknown>;
  for (const key of Object.keys(rootRecord)) {
    if (key === "parent") continue;
    const child = rootRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item) && someNodeInSubtree(item, predicate)) return true;
      }
    } else if (isAstNode(child) && someNodeInSubtree(child, predicate)) {
      return true;
    }
  }
  return false;
};

const MESSAGE =
  "This passes an href/hash-derived string to a `querySelector` call, which throws a `DOMException` on an invalid CSS selector instead of returning null. Wrap the call in try/catch or escape the value with `CSS.escape`.";

const SELECTOR_QUERY_METHOD_NAMES = new Set([
  "querySelector",
  "querySelectorAll",
  "matches",
  "closest",
]);
const ELEMENT_RECEIVER_METHOD_NAMES = new Set(["matches", "closest"]);
const HREF_ATTRIBUTE_NAMES = new Set(["href", "hash"]);
const HREF_HASH_FUNCTION_PATTERN = /href|hash/i;
const SHAPE_VALIDATION_METHOD_NAMES = new Set([
  "match",
  "test",
  "startsWith",
  "endsWith",
  "indexOf",
  "includes",
]);
const DEFERRED_CALLBACK_REGISTRAR_NAMES = new Set([
  "addEventListener",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
  "setImmediate",
]);
const DOM_ELEMENT_NAME_SEGMENTS = new Set([
  "el",
  "elem",
  "element",
  "node",
  "anchor",
  "target",
  "current",
  "ref",
  "dom",
  "body",
  "document",
  "container",
  "parent",
  "link",
  "button",
]);

const isHrefOrHashAttributeName = (value: unknown): boolean =>
  typeof value === "string" && HREF_ATTRIBUTE_NAMES.has(value);

// `el.getAttribute("href")` / `el.getAttribute("hash")`.
const isHrefGetAttributeCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (getStaticMemberPropertyName(node.callee) !== "getAttribute") return false;
  const firstArgument = node.arguments?.[0];
  return Boolean(
    firstArgument &&
    isNodeOfType(firstArgument, "Literal") &&
    isHrefOrHashAttributeName(firstArgument.value),
  );
};

// A member access whose property is `href`/`hash` (`el.href`, `location.hash`).
const isHrefHashMemberAccess = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const propertyName = getStaticMemberPropertyName(node);
  return Boolean(propertyName && HREF_ATTRIBUTE_NAMES.has(propertyName));
};

// A call to a helper named like `getHashFromHref` / `getHref` / `hashFor`.
const isHrefHashNamedCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return HREF_HASH_FUNCTION_PATTERN.test(callee.name);
  const propertyName = getStaticMemberPropertyName(callee);
  return Boolean(propertyName && HREF_HASH_FUNCTION_PATTERN.test(propertyName));
};

const isCssEscapeCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  isNodeOfType(node.callee.object, "Identifier") &&
  node.callee.object.name === "CSS" &&
  getStaticMemberPropertyName(node.callee) === "escape";

// An href/hash-named helper whose in-file definition sanitizes with
// `CSS.escape` — its output is exactly the fix the rule recommends.
const isSanitizedSelectorHelperCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  return Boolean(binding?.initializer && someNodeInSubtree(binding.initializer, isCssEscapeCall));
};

const isHrefHashDerivedExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (isHrefGetAttributeCall(stripped) || isHrefHashMemberAccess(stripped)) return true;
  return isHrefHashNamedCall(stripped) && !isSanitizedSelectorHelperCall(stripped);
};

// The selector argument taints to an href/hash value: either directly, or
// through a same-file binding whose initializer is href/hash-derived.
const selectorArgumentTaintsToHref = (argument: EsTreeNode): boolean => {
  if (isHrefHashDerivedExpression(argument)) return true;
  const stripped = stripParenExpression(argument);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  return Boolean(binding?.initializer && isHrefHashDerivedExpression(binding.initializer));
};

const isStringLiteralSelector = (argument: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Literal")) return typeof stripped.value === "string";
  return isNodeOfType(stripped, "TemplateLiteral") && stripped.expressions.length === 0;
};

const hasDomElementNameSegment = (name: string): boolean =>
  name
    .split(/[^A-Za-z]+/)
    .flatMap((word) => word.split(/(?=[A-Z])/))
    .some((segment) => DOM_ELEMENT_NAME_SEGMENTS.has(segment.toLowerCase()));

// `matches`/`closest` also exist on route matchers, URLPattern-style objects,
// and hash routers, none of which throw on an invalid CSS selector — only
// fire when the receiver's name reads as a DOM element.
const isLikelyDomElementReceiver = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return hasDomElementNameSegment(stripped.name);
  const propertyName = getStaticMemberPropertyName(stripped);
  return Boolean(propertyName && hasDomElementNameSegment(propertyName));
};

const makeTaintedReferenceMatcher = (
  selectorArgument: EsTreeNode,
): ((candidate: EsTreeNode) => boolean) => {
  const stripped = stripParenExpression(selectorArgument);
  const taintedName = isNodeOfType(stripped, "Identifier") ? stripped.name : null;
  return (candidate: EsTreeNode): boolean => {
    if (taintedName && isNodeOfType(candidate, "Identifier") && candidate.name === taintedName) {
      return true;
    }
    return isHrefHashDerivedExpression(candidate);
  };
};

// `hash.startsWith('#')`, `HASH_PATTERN.test(hash)`,
// `knownIds.indexOf(location.hash) !== -1` — the tainted value appears as the
// receiver or an argument of a string/regex shape check, not a bare
// truthiness read.
const isShapeValidatingCall = (
  node: EsTreeNode,
  referencesTaintedValue: (candidate: EsTreeNode) => boolean,
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  const methodName = getStaticMemberPropertyName(node.callee);
  if (!methodName || !SHAPE_VALIDATION_METHOD_NAMES.has(methodName)) return false;
  if (someNodeInSubtree(node.callee.object, referencesTaintedValue)) return true;
  return (node.arguments ?? []).some((argument) =>
    someNodeInSubtree(argument, referencesTaintedValue),
  );
};

const isEarlyExitStatement = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "BlockStatement")) {
    const lastStatement = node.body[node.body.length - 1];
    return Boolean(lastStatement && isEarlyExitStatement(lastStatement));
  }
  return (
    node.type === "ReturnStatement" ||
    node.type === "ThrowStatement" ||
    node.type === "ContinueStatement" ||
    node.type === "BreakStatement"
  );
};

// Every conditional test that dominates the query call: enclosing
// if/ternary/logical-&& tests plus preceding early-exit guards
// (`if (…) return;`) in the statement lists between the call and the root.
const collectDominatingGuardTests = (callNode: EsTreeNode): EsTreeNode[] => {
  const guardTests: EsTreeNode[] = [];
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "IfStatement") && ancestor.test !== child) {
      guardTests.push(ancestor.test);
    } else if (isNodeOfType(ancestor, "ConditionalExpression") && ancestor.test !== child) {
      guardTests.push(ancestor.test);
    } else if (isNodeOfType(ancestor, "LogicalExpression") && ancestor.right === child) {
      guardTests.push(ancestor.left);
    } else if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements = ancestor.body;
      const childStatementIndex = statements.findIndex((statement) => statement === child);
      for (let statementIndex = 0; statementIndex < childStatementIndex; statementIndex += 1) {
        const statement = statements[statementIndex];
        if (isNodeOfType(statement, "IfStatement") && isEarlyExitStatement(statement.consequent)) {
          guardTests.push(statement.test);
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return guardTests;
};

// A dominating guard already shape-validated the tainted value (regex test,
// prefix check, containment check) — the selector's shape is self-controlled,
// so the DOMException the rule warns about cannot occur in practice. Bare
// truthiness guards (`if (href)`) do NOT count.
const isShapeValidatedByDominatingGuard = (
  callNode: EsTreeNode,
  selectorArgument: EsTreeNode,
): boolean => {
  const referencesTaintedValue = makeTaintedReferenceMatcher(selectorArgument);
  return collectDominatingGuardTests(callNode).some((guardTest) =>
    someNodeInSubtree(guardTest, (candidate) =>
      isShapeValidatingCall(candidate, referencesTaintedValue),
    ),
  );
};

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const getCalleeStaticName = (callNode: EsTreeNodeOfType<"CallExpression">): string | null => {
  const callee = stripParenExpression(callNode.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  return getStaticMemberPropertyName(callee);
};

// The nearest enclosing function that is passed to a deferred-callback
// registrar (addEventListener, setTimeout, …). A try block around the
// registration does NOT guard the callback body — it runs after the try
// frame is gone — so the try walk must stop there.
const findDeferredCallbackBoundary = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLikeNode(ancestor)) {
      const enclosingCall = ancestor.parent;
      if (
        enclosingCall &&
        isNodeOfType(enclosingCall, "CallExpression") &&
        enclosingCall.arguments?.some((argument) => argument === ancestor)
      ) {
        const registrarName = getCalleeStaticName(enclosingCall);
        if (registrarName && DEFERRED_CALLBACK_REGISTRAR_NAMES.has(registrarName)) {
          return ancestor;
        }
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// Flags `document.querySelector(x)` / `querySelectorAll` / `Element.matches` /
// `closest` when the selector argument taints to an anchor href/hash value and
// the call is not inside try/catch. The query throws a `DOMException` on an
// invalid selector, so an href fragment like `#section 1` crashes the handler.
//
// v1 scope: only the high-confidence href/hash sink fires. String literals,
// CSS-module templates, `CSS.escape` outputs (including in-file helpers that
// wrap it), SCREAMING_SNAKE selector constants, opaque `props.*Selector`
// config values, non-DOM `matches()`/`closest()` receivers (route matchers),
// and values shape-validated by a dominating guard (regex test, prefix or
// containment check) are intentionally quiet.
export const noNonLiteralSelectorQueryWithoutTryCatch = defineRule({
  id: "no-non-literal-selector-query-without-try-catch",
  title: "Unguarded querySelector with href-derived selector",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`querySelector`/`querySelectorAll`/`matches`/`closest` throw a `DOMException` on an invalid CSS selector, and href/hash fragments are frequently invalid. Wrap the call in try/catch or normalize the value with `CSS.escape`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return;
      const methodName = getStaticMemberPropertyName(callee);
      if (!methodName || !SELECTOR_QUERY_METHOD_NAMES.has(methodName)) return;
      if (
        ELEMENT_RECEIVER_METHOD_NAMES.has(methodName) &&
        !isLikelyDomElementReceiver(callee.object)
      ) {
        return;
      }
      const selectorArgument = node.arguments?.[0];
      if (!selectorArgument || isNodeOfType(selectorArgument, "SpreadElement")) return;
      if (isStringLiteralSelector(selectorArgument)) return;
      if (!selectorArgumentTaintsToHref(selectorArgument)) return;
      if (isShapeValidatedByDominatingGuard(node, selectorArgument)) return;
      if (
        isInsideTryStatement(node as EsTreeNode, {
          region: "block",
          boundary: findDeferredCallbackBoundary(node),
        })
      ) {
        return;
      }
      context.report({ node, message: MESSAGE });
    },
  }),
});
