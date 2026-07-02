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

const isPromiseSettleAccess = (member: EsTreeNodeOfType<"MemberExpression">): boolean =>
  !member.computed &&
  isNodeOfType(member.property, "Identifier") &&
  PROMISE_SETTLE_METHODS.has(member.property.name);

const isDestructureOfReference = (parent: EsTreeNode, referenceIdentifier: EsTreeNode): boolean =>
  isNodeOfType(parent, "VariableDeclarator") &&
  parent.init === referenceIdentifier &&
  isNodeOfType(parent.id, "ObjectPattern");

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
      context.report({ node: object, message: MESSAGE });
    },
    // Await-less assignment then member use (`const c = cookies(); c.get(...)`)
    // or destructuring off the call (`const { isEnabled } = draftMode()`).
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init) return;
      const init = stripParenExpression(node.init);
      if (!isNextHeadersDynamicCall(context, init)) return;
      if (isNodeOfType(node.id, "ObjectPattern")) {
        context.report({ node: init, message: MESSAGE });
        return;
      }
      if (!isNodeOfType(node.id, "Identifier")) return;
      const symbol = context.scopes.symbolFor(node.id);
      if (!symbol) return;
      for (const reference of symbol.references) {
        const referenceIdentifier = reference.identifier;
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
