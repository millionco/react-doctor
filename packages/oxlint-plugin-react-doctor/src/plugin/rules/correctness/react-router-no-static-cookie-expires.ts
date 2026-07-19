import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const COOKIE_FACTORY_EXPORT_NAMES = new Set(["createCookie", "createCookieSessionStorage"]);

const findCookieFactoryCall = (context: RuleContext, node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (isNodeOfType(current, "CallExpression") && isNodeOfType(current.callee, "Identifier")) {
      const importedName = getImportedNameFromReactRouter(
        context,
        current.callee,
        current.callee.name,
      );
      return importedName !== null && COOKIE_FACTORY_EXPORT_NAMES.has(importedName);
    }
    current = current.parent;
  }
  return false;
};

export const reactRouterNoStaticCookieExpires = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-static-cookie-expires",
    title: "Cookie expiry is fixed at module load",
    tags: ["test-noise"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    recommendation: "Use maxAge for a duration-based cookie lifetime.",
    create: (context: RuleContext) => ({
      Property(node: EsTreeNodeOfType<"Property">) {
        if (getStaticPropertyKeyName(node, { allowComputedString: true }) !== "expires") return;
        if (!isNodeOfType(node.value, "NewExpression")) return;
        if (!isNodeOfType(node.value.callee, "Identifier") || node.value.callee.name !== "Date")
          return;
        if (!context.scopes.isGlobalReference(node.value.callee)) return;
        if (findEnclosingFunction(node) !== null) return;
        const expirationArgument = node.value.arguments?.[0];
        if (isNodeOfType(expirationArgument, "Literal")) return;
        if (!findCookieFactoryCall(context, node)) return;
        context.report({
          node,
          message:
            "This cookie expiration Date is created once at module load and becomes stale for later requests.",
        });
      },
    }),
  }),
);
