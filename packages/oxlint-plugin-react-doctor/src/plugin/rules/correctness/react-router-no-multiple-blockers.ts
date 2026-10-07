import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoMultipleBlockers = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-multiple-blockers",
    title: "Multiple blockers in one component",
    tags: ["test-noise"],
    requires: ["react-router:6.7"],
    severity: "error",
    recommendation: "Combine blocking conditions into one useBlocker call per rendered component.",
    create: (context: RuleContext) => {
      const blockerOwnerFunctions = new Set<EsTreeNode>();
      return {
        CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
          if (!isNodeOfType(node.callee, "Identifier")) return;
          const importedName = getImportedNameFromReactRouter(
            context,
            node.callee,
            node.callee.name,
          );
          const isStableBlocker =
            importedName === "useBlocker" && hasCapability(context.settings, "react-router:6.19");
          if (!isStableBlocker && importedName !== "unstable_useBlocker") return;
          const ownerFunction = findEnclosingFunction(node);
          if (ownerFunction === null) return;
          if (isNodeConditionallyExecuted(node, ownerFunction)) return;
          if (!blockerOwnerFunctions.has(ownerFunction)) {
            blockerOwnerFunctions.add(ownerFunction);
            return;
          }
          context.report({
            node,
            message: "This component registers more than one unconditional navigation blocker.",
          });
        },
      };
    },
  }),
);
