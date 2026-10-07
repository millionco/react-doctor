import { REACT_ROUTER_SESSION_STORAGE_FACTORY_EXPORT_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const COOKIE_FACTORY_EXPORT_NAMES = new Set([
  "createCookie",
  ...REACT_ROUTER_SESSION_STORAGE_FACTORY_EXPORT_NAMES,
]);

const findCookieFactoryCall = (context: RuleContext, node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (isNodeOfType(current, "CallExpression") && isNodeOfType(current.callee, "Identifier")) {
      const importedName = getImportedNameFromReactRouter(
        context,
        current.callee,
        current.callee.name,
      );
      if (importedName !== null && COOKIE_FACTORY_EXPORT_NAMES.has(importedName)) return true;
    }
    current = current.parent;
  }
  return false;
};

const containsGlobalDateNowCall = (context: RuleContext, node: EsTreeNode): boolean => {
  let didFindDateNowCall = false;
  walkAst(node, (descendant) => {
    if (!isNodeOfType(descendant, "CallExpression")) return;
    if (!isNodeOfType(descendant.callee, "MemberExpression")) return;
    if (getStaticPropertyKeyName(descendant.callee, { allowComputedString: true }) !== "now") {
      return;
    }
    const receiver = descendant.callee.object;
    if (!isNodeOfType(receiver, "Identifier") || receiver.name !== "Date") return;
    if (!context.scopes.isGlobalReference(receiver)) return;
    didFindDateNowCall = true;
    return false;
  });
  return didFindDateNowCall;
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
        if (!expirationArgument || !containsGlobalDateNowCall(context, expirationArgument)) return;
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
