import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isTanstackQuerySource } from "../../utils/is-tanstack-query-source.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// True when the whole-query binding is FORWARDED rather than consumed
// field-by-field in this scope: returned from a custom hook, passed as a JSX
// attribute / call argument, or spread. Those are the documented
// wrap-a-query patterns — TanStack's tracked-properties optimization keys off
// which fields are accessed during render, so forwarding the object does not
// "subscribe to every field." A reference that is the object of a member
// access (`query.data`) is a field read and keeps the binding flag-eligible.
const isForwardedBinding = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  bindingName: string,
): boolean => {
  let enclosingScope: EsTreeNode | null | undefined = declarator.parent;
  while (enclosingScope && !isFunctionLike(enclosingScope)) {
    enclosingScope = enclosingScope.parent ?? null;
  }
  const scope = enclosingScope ?? declarator.parent;
  if (!scope) return false;

  let forwarded = false;
  walkAst(scope, (node: EsTreeNode) => {
    if (forwarded) return;
    if (!isNodeOfType(node, "Identifier") || node.name !== bindingName) return;
    if (node === declarator.id) return;
    const parent = node.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === node) return;
    forwarded = true;
  });
  return forwarded;
};

export const queryDestructureResult = defineRule({
  id: "query-destructure-result",
  title: "Whole query result subscribes to every field",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "error",
  recommendation:
    "Destructure only the fields you need, like `const { data, isLoading } = useQuery(...)`. Assigning the whole object bypasses TanStack Query's tracked-property optimization and subscribes to every field.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier")) return;
      if (!node.init || !isNodeOfType(node.init, "CallExpression")) return;

      const calleeName = isNodeOfType(node.init.callee, "Identifier")
        ? node.init.callee.name
        : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      // Only flag when the hook actually comes from TanStack Query. A hook of
      // the same name imported from another library (e.g. `convex/react`) does
      // not return a tracked result object, so destructuring it would be wrong.
      // `null` (no import in this file — a global, an auto-import, or a call
      // before its declaration) still fires, preserving prior behavior. A
      // `useQuery` re-exported through a LOCAL module reports that module as its
      // source and is intentionally skipped: a per-file rule can't follow the
      // re-export chain, and firing on an unverified local source would
      // re-introduce the Convex false positive this gate exists to prevent.
      const importSource = getImportSourceForName(node, calleeName);
      if (importSource !== null && !isTanstackQuerySource(importSource)) return;

      if (isForwardedBinding(node, node.id.name)) return;

      context.report({
        node: node.id,
        message: `Destructure ${calleeName}() results instead of assigning the whole query object, so TanStack Query only subscribes to the fields you use.`,
      });
    },
  }),
});
