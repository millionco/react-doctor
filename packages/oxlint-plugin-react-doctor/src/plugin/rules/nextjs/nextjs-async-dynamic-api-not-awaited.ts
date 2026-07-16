import { PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ReferenceDescriptor } from "../../semantic/scope-analysis.js";

const DYNAMIC_API_NAMES = new Set(["cookies", "headers", "draftMode"]);

const MESSAGE =
  "This `next/headers` API returns a Promise in Next.js 15, so reading a property off the un-awaited call throws at request time — `await` the call first.";

const resolvesToImportBinding = (context: RuleContext, identifier: EsTreeNode): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  return symbol !== null && symbol.kind === "import";
};

// A call to `cookies()`/`headers()`/`draftMode()` whose callee resolves —
// through the scope chain, so same-named locals shadowing the import do not
// match — to the actual `next/headers` import in this file. Covers named
// imports (renames resolve to their canonical name) and namespace-import
// member calls like `nextHeaders.headers()`.
const isNextHeadersDynamicCall = (context: RuleContext, node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) {
    if (!resolvesToImportBinding(context, callee)) return false;
    const importedName = getImportedNameFromModule(node, callee.name, "next/headers");
    return importedName !== null && DYNAMIC_API_NAMES.has(importedName);
  }
  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const namespaceObject = stripParenExpression(callee.object);
    if (
      !isNodeOfType(namespaceObject, "Identifier") ||
      !isNodeOfType(callee.property, "Identifier") ||
      !DYNAMIC_API_NAMES.has(callee.property.name)
    ) {
      return false;
    }
    if (!resolvesToImportBinding(context, namespaceObject)) return false;
    return isNamespaceImportFromModule(node, namespaceObject.name, "next/headers");
  }
  return false;
};

// The `next-async-request-api` codemod's escape hatch: casting the call to
// `UnsafeUnwrappedCookies`/`UnsafeUnwrappedHeaders`/`UnsafeUnwrappedDraftMode`
// opts into Next 15's temporary synchronous access — a deliberate, typed
// assertion the rule must respect.
const UNSAFE_UNWRAPPED_TYPE_PATTERN = /^UnsafeUnwrapped/;

// `ParenthesizedExpression` is a real oxc runtime node absent from the
// TSESTree union, so wrappers are matched via a string set.
const CAST_CHAIN_WRAPPER_TYPES = new Set<string>([
  "TSAsExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
  "TSNonNullExpression",
]);
const CAST_NODE_TYPES = new Set<string>(["TSAsExpression", "TSTypeAssertion"]);

const castChainAssertsUnsafeUnwrapped = (expression: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = expression;
  while (cursor) {
    const cursorRecord = cursor as unknown as Record<string, unknown>;
    if (CAST_NODE_TYPES.has(cursor.type)) {
      const typeAnnotation = cursorRecord.typeAnnotation as EsTreeNode | undefined;
      const typeName =
        typeAnnotation && (typeAnnotation as unknown as Record<string, unknown>).typeName;
      if (
        typeName &&
        isNodeOfType(typeName as EsTreeNode, "Identifier") &&
        UNSAFE_UNWRAPPED_TYPE_PATTERN.test((typeName as EsTreeNodeOfType<"Identifier">).name)
      ) {
        return true;
      }
    }
    if (CAST_CHAIN_WRAPPER_TYPES.has(cursor.type)) {
      cursor = cursorRecord.expression as EsTreeNode | undefined;
      continue;
    }
    return false;
  }
  return false;
};

const isPromiseSettleAccess = (member: EsTreeNodeOfType<"MemberExpression">): boolean =>
  !member.computed &&
  isNodeOfType(member.property, "Identifier") &&
  PROMISE_SETTLE_METHODS.has(member.property.name);

const isDestructureOfReference = (parent: EsTreeNode, referenceIdentifier: EsTreeNode): boolean =>
  isNodeOfType(parent, "VariableDeclarator") &&
  parent.init === referenceIdentifier &&
  isNodeOfType(parent.id, "ObjectPattern");

// HACK: oxc's parseSync emits ESTree byte offsets as `start`/`end` (never
// `range`), which TSESTree's types don't declare — so read them structurally.
const getNodeStartIndex = (node: EsTreeNode): number =>
  "start" in node && typeof node.start === "number" ? node.start : -1;

// After the binding is reassigned (e.g. `c = await c`) it no longer holds the
// un-awaited promise, so only uses before the first write can be violations.
const firstReassignmentStart = (references: readonly ReferenceDescriptor[]): number => {
  let earliestWriteStart = Number.POSITIVE_INFINITY;
  for (const reference of references) {
    if (reference.flag === "read") continue;
    const writeStart = getNodeStartIndex(reference.identifier);
    if (writeStart < 0) continue;
    earliestWriteStart = Math.min(earliestWriteStart, writeStart);
  }
  return earliestWriteStart;
};

export const nextjsAsyncDynamicApiNotAwaited = defineRule({
  id: "nextjs-async-dynamic-api-not-awaited",
  title: "Un-awaited async next/headers API",
  tags: ["test-noise"],
  requires: ["nextjs:15"],
  severity: "error",
  recommendation:
    "Await `cookies()`, `headers()`, and `draftMode()` from `next/headers` before reading their properties. They became async in Next.js 15.",
  create: (context: RuleContext) => ({
    // Direct member access on the sync call result: `headers().get(...)`.
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const object = stripParenExpression(node.object);
      if (!isNextHeadersDynamicCall(context, object)) return;
      if (isPromiseSettleAccess(node)) return;
      if (castChainAssertsUnsafeUnwrapped(node.object)) return;
      context.report({ node: object, message: MESSAGE });
    },
    // Await-less assignment then member use (`const c = cookies(); c.get(...)`)
    // or destructuring off the call (`const { isEnabled } = draftMode()`).
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init) return;
      const init = stripParenExpression(node.init);
      if (!isNextHeadersDynamicCall(context, init)) return;
      if (castChainAssertsUnsafeUnwrapped(node.init)) return;
      if (isNodeOfType(node.id, "ObjectPattern")) {
        context.report({ node: init, message: MESSAGE });
        return;
      }
      if (!isNodeOfType(node.id, "Identifier")) return;
      const symbol = context.scopes.symbolFor(node.id);
      if (!symbol) return;
      const reassignmentStart = firstReassignmentStart(symbol.references);
      for (const reference of symbol.references) {
        const referenceIdentifier = reference.identifier;
        const referenceStart = getNodeStartIndex(referenceIdentifier);
        if (referenceStart >= 0 && referenceStart >= reassignmentStart) continue;
        const parent = referenceIdentifier.parent;
        if (!parent) continue;
        if (isDestructureOfReference(parent, referenceIdentifier)) {
          context.report({ node: init, message: MESSAGE });
          return;
        }
        if (!isNodeOfType(parent, "MemberExpression")) continue;
        if (parent.object !== referenceIdentifier) continue;
        if (isPromiseSettleAccess(parent)) continue;
        context.report({ node: init, message: MESSAGE });
        return;
      }
    },
  }),
});
