import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// TanStack Query packages (`@tanstack/react-query`, `@tanstack/vue-query`,
// `@tanstack/query-core`, the Angular `*-query-experimental`, …) plus the
// legacy `react-query`. A `useQuery` imported from anything else — notably
// Convex's `convex/react`, whose `useQuery` returns the data directly — must
// not be treated as a TanStack result object.
const TANSTACK_QUERY_PACKAGE_PATTERN = /^@tanstack\/[\w-]*query[\w-]*$/;
const isTanstackQuerySource = (source: string): boolean =>
  TANSTACK_QUERY_PACKAGE_PATTERN.test(source) || source === "react-query";

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

      context.report({
        node: node.id,
        message: `Destructure ${calleeName}() results instead of assigning the whole query object, so TanStack Query only subscribes to the fields you use.`,
      });
    },
  }),
});
