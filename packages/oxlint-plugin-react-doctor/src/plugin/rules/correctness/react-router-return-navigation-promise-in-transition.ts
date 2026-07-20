import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterReturnNavigationPromiseInTransition = wrapReactRouterRule(
  defineRule({
    id: "react-router-return-navigation-promise-in-transition",
    title: "Transition drops a navigation promise",
    tags: ["test-noise"],
    requires: ["react-router:7.10"],
    severity: "warn",
    recommendation:
      "Return or await the navigation promise from the transition callback so pending state lasts through navigation.",
    create: (context: RuleContext) => {
      let routerProviderCount = 0;
      let transitionEnabledRouterCount = 0;
      const droppedNavigationCalls: EsTreeNode[] = [];
      return {
        JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
          if (!isNodeOfType(node.name, "JSXIdentifier")) return;
          if (
            getImportedNameFromReactRouter(context, node.name, node.name.name) !== "RouterProvider"
          ) {
            return;
          }
          routerProviderCount += 1;
          const isTransitionEnabled = (node.attributes ?? []).some((attribute) => {
            if (!isNodeOfType(attribute, "JSXAttribute")) return false;
            const attributeName = getJsxAttributeName(attribute.name);
            const isTransitionAttribute =
              attributeName === "unstable_useTransitions" ||
              (attributeName === "useTransitions" &&
                hasCapability(context.settings, "react-router:7.15"));
            if (!isTransitionAttribute) return false;
            if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
            return readStaticBoolean(attribute.value.expression) !== false;
          });
          if (isTransitionEnabled) transitionEnabledRouterCount += 1;
        },
        VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
          if (!isNodeOfType(node.id, "Identifier")) return;
          if (!isNodeOfType(node.init, "CallExpression")) return;
          if (!isNodeOfType(node.init.callee, "Identifier")) return;
          if (
            getImportedNameFromReactRouter(context, node.init.callee, node.init.callee.name) !==
            "useNavigate"
          ) {
            return;
          }
          const navigateSymbol = context.scopes.symbolFor(node.id);
          if (navigateSymbol === null) return;
          for (const reference of navigateSymbol.references) {
            const navigationCall = reference.identifier.parent;
            if (!isNodeOfType(navigationCall, "CallExpression")) continue;
            if (navigationCall.callee !== reference.identifier) continue;
            if (
              !isResultDiscardedCall(navigationCall, {
                areConciseArrowReturnsDiscarded: false,
              })
            ) {
              continue;
            }
            const callback = findEnclosingFunction(navigationCall);
            if (callback === null) continue;
            const transitionCall = callback.parent;
            if (!isNodeOfType(transitionCall, "CallExpression")) continue;
            if (!isNodeOfType(transitionCall.callee, "Identifier")) continue;
            if (transitionCall.arguments?.[0] !== callback) continue;
            if (context.scopes.symbolFor(transitionCall.callee)?.kind !== "import") continue;
            if (
              getImportedNameFromModule(
                transitionCall.callee,
                transitionCall.callee.name,
                "react",
              ) !== "startTransition"
            ) {
              continue;
            }
            droppedNavigationCalls.push(navigationCall);
          }
        },
        "Program:exit"() {
          if (routerProviderCount !== 1 || transitionEnabledRouterCount !== 1) return;
          for (const navigationCall of droppedNavigationCalls) {
            context.report({
              node: navigationCall,
              message: "This transition callback drops the promise returned by navigation.",
            });
          }
        },
      };
    },
  }),
);
