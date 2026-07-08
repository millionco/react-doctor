import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isTanstackQuerySource } from "../../utils/is-tanstack-query-source.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import type { RuleContext } from "../../utils/rule-context.js";

// TanStack Query result objects track field access through property getters,
// so `query.data` subscribes to exactly `data` — identical to destructuring.
// The only consumptions that genuinely subscribe to every field are the ones
// that ENUMERATE the object: spreading it into an object literal or JSX
// attributes, or rest-destructuring it through a later binding. Everything
// else (field reads, forwarding, dependency arrays) is field-tracked or
// tracked at the eventual read site, and must stay silent.
// `return { ...query, isLoading: ... }` inside a custom hook forwards the
// whole result object as the hook's own return value: the spread happens once
// per hook render, and which fields are SUBSCRIBED to is still decided at the
// consumer's read site. Destructuring here cannot reduce re-renders, so this
// forwarding spread must stay silent.
const isHookReturnForwardingSpread = (objectExpression: EsTreeNode): boolean => {
  const objectParent = objectExpression.parent;
  const enclosingFunction = findEnclosingFunction(objectExpression);
  if (!enclosingFunction) return false;
  const isReturnedFromEnclosingFunction =
    isNodeOfType(objectParent, "ReturnStatement") ||
    (isNodeOfType(enclosingFunction, "ArrowFunctionExpression") &&
      enclosingFunction.body === objectExpression);
  if (!isReturnedFromEnclosingFunction) return false;
  const enclosingName = componentOrHookDisplayNameForFunction(enclosingFunction);
  return Boolean(enclosingName && isReactHookName(enclosingName));
};

const classifyEveryFieldRead = (identifier: EsTreeNode): "spread" | "rest-destructuring" | null => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const parent = expressionRoot.parent;
  if (isNodeOfType(parent, "JSXSpreadAttribute")) return "spread";
  if (isNodeOfType(parent, "SpreadElement") && isNodeOfType(parent.parent, "ObjectExpression")) {
    return isHookReturnForwardingSpread(parent.parent) ? null : "spread";
  }
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expressionRoot &&
    isNodeOfType(parent.id, "ObjectPattern") &&
    parent.id.properties.some((property) => isNodeOfType(property, "RestElement"))
  ) {
    return "rest-destructuring";
  }
  return null;
};

export const queryDestructureResult = defineRule({
  id: "query-destructure-result",
  title: "Spreading a whole query result subscribes to every field",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "TanStack Query only subscribes to the fields you actually read, so `query.data` is as targeted as destructuring. Spreading or rest-destructuring the whole result reads every field and re-renders on each change; pick out only the fields you need.",
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
      // not return a tracked result object. `null` (no import in this file —
      // a global, an auto-import, or a call before its declaration) still
      // fires, preserving prior behavior. A `useQuery` re-exported through a
      // LOCAL module reports that module as its source and is intentionally
      // skipped: a per-file rule can't follow the re-export chain.
      const importSource = getImportSourceForName(node, calleeName);
      if (importSource !== null && !isTanstackQuerySource(importSource)) return;

      const bindingSymbol = context.scopes.symbolFor(node.id);
      if (!bindingSymbol) return;

      for (const reference of bindingSymbol.references) {
        const referenceIdentifier = reference.identifier;
        if (referenceIdentifier === node.id) continue;
        const everyFieldRead = classifyEveryFieldRead(referenceIdentifier);
        if (!everyFieldRead) continue;
        context.report({
          node: referenceIdentifier,
          message:
            everyFieldRead === "spread"
              ? `Spreading the whole ${calleeName}() result reads every field, so TanStack Query subscribes to all of them and re-renders on each change. Spread only the fields you need.`
              : `Rest-destructuring the ${calleeName}() result reads every field, so TanStack Query subscribes to all of them and re-renders on each change.`,
        });
      }
    },
  }),
});
