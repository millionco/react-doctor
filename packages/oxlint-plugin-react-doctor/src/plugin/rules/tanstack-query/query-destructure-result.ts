import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isTanstackQuerySource } from "../../utils/is-tanstack-query-source.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

// Wrappers that are transparent for "is this expression what the function
// returns": `return preferCache ? cachedQuery : remoteQuery`,
// `return query ?? fallback`, `return query as UseQueryResult`, `query!`.
const RETURNED_EXPRESSION_WRAPPER_TYPES = new Set<string>([
  "ConditionalExpression",
  "LogicalExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
]);

const findReturnedExpressionRoot = (identifier: EsTreeNode): EsTreeNode => {
  let current = identifier;
  while (current.parent && RETURNED_EXPRESSION_WRAPPER_TYPES.has(current.parent.type)) {
    current = current.parent;
  }
  return current;
};

// A reference position that actually hands the whole object onward:
// returned from a custom hook (incl. an arrow's implicit return, a returned
// tuple/object literal, and a conditional/logical/TS-wrapped return), wired
// into JSX, spread, or re-bound (`const q = query` / `const { data } = query`).
// A mere mention — an effect dependency array `[query]`, a diagnostic
// `console.log(query)` / `useDebugValue(query)` call argument — is NOT
// forwarding, so it must not silence the rule for a component that reads
// `query.data` field-by-field in render.
const isForwardingReference = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (isNodeOfType(parent, "SpreadElement") || isNodeOfType(parent, "JSXSpreadAttribute")) {
    return true;
  }
  if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
  if (isNodeOfType(parent, "Property") && parent.value === identifier) return true;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === identifier) return true;

  const returnedRoot = findReturnedExpressionRoot(identifier);
  const returnedParent = returnedRoot.parent;
  if (isNodeOfType(returnedParent, "ReturnStatement")) return true;
  if (
    isNodeOfType(returnedParent, "ArrowFunctionExpression") &&
    returnedParent.body === returnedRoot
  ) {
    return true;
  }
  if (isNodeOfType(returnedParent, "ArrayExpression")) {
    const grandparent = returnedParent.parent;
    if (isNodeOfType(grandparent, "ReturnStatement")) return true;
    if (
      isNodeOfType(grandparent, "ArrowFunctionExpression") &&
      grandparent.body === returnedParent
    ) {
      return true;
    }
  }
  return false;
};

// True when the whole-query binding is FORWARDED rather than consumed
// field-by-field in this scope: returned from a custom hook, passed as a JSX
// attribute, spread, or re-bound. Those are the documented wrap-a-query
// patterns — TanStack's tracked-properties optimization keys off which fields
// are accessed during render, so forwarding the object does not "subscribe to
// every field." References are resolved through scope analysis, so a shadowed
// unrelated binding of the same name never counts. A reference that is the
// object of a member access (`query.data`) is a field read and keeps the
// binding flag-eligible.
const isForwardedBinding = (bindingIdentifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const bindingSymbol = scopes.symbolFor(bindingIdentifier);
  if (!bindingSymbol) return false;
  return bindingSymbol.references.some((reference) => {
    const referenceIdentifier = reference.identifier;
    if (referenceIdentifier === bindingIdentifier) return false;
    const parent = referenceIdentifier.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === referenceIdentifier) {
      return false;
    }
    return isForwardingReference(referenceIdentifier);
  });
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

      if (isForwardedBinding(node.id, context.scopes)) return;

      context.report({
        node: node.id,
        message: `Destructure ${calleeName}() results instead of assigning the whole query object, so TanStack Query only subscribes to the fields you use.`,
      });
    },
  }),
});
