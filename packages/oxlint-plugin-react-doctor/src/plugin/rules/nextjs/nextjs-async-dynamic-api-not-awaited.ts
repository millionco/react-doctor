import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const DYNAMIC_API_NAMES = new Set(["cookies", "headers", "draftMode"]);

// Accessing `.then`/`.catch`/`.finally` on the returned Promise is
// correct async handling, not the sync-access bug.
const PROMISE_SETTLE_METHODS = new Set(["then", "catch", "finally"]);

// A call to `cookies()`/`headers()`/`draftMode()` whose callee resolves to
// the actual `next/headers` import in this file (renamed imports resolve to
// their canonical name; same-named locals or other modules do not match).
const isNextHeadersDynamicCall = (node: EsTreeNode): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "Identifier")
  ) {
    return false;
  }
  const importedName = getImportedNameFromModule(
    node,
    node.callee.name,
    "next/headers"
  );
  return importedName !== null && DYNAMIC_API_NAMES.has(importedName);
};

const isPromiseSettleAccess = (
  member: EsTreeNodeOfType<"MemberExpression">
): boolean =>
  !member.computed &&
  isNodeOfType(member.property, "Identifier") &&
  PROMISE_SETTLE_METHODS.has(member.property.name);

const buildMessage = (): string =>
  "This `next/headers` API returns a Promise in Next.js 15, so reading a property off the un-awaited call throws at request time — `await` the call first.";

export const nextjsAsyncDynamicApiNotAwaited = defineRule({
  id: "nextjs-async-dynamic-api-not-awaited",
  title: "Un-awaited async next/headers API",
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Await `cookies()`, `headers()`, and `draftMode()` from `next/headers` before reading their properties. They became async in Next.js 15.",
  create: (context: RuleContext) => ({
    // Direct member access on the sync call result: `headers().get(...)`.
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const object = stripParenExpression(node.object);
      if (!isNextHeadersDynamicCall(object)) return;
      if (isPromiseSettleAccess(node)) return;
      context.report({ node: object, message: buildMessage() });
    },
    // Await-less assignment then member use: `const c = cookies(); c.get(...)`.
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier") || !node.init) return;
      const init = stripParenExpression(node.init);
      if (!isNextHeadersDynamicCall(init)) return;
      const symbol = context.scopes.symbolFor(node.id);
      if (!symbol) return;
      for (const reference of symbol.references) {
        const referenceIdentifier = reference.identifier;
        const parent = referenceIdentifier.parent;
        if (!parent || !isNodeOfType(parent, "MemberExpression")) continue;
        if (parent.object !== referenceIdentifier) continue;
        if (isPromiseSettleAccess(parent)) continue;
        context.report({ node: init, message: buildMessage() });
        return;
      }
    },
  }),
});
