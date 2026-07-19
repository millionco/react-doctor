import { REACT_ROUTER_SEARCH_PARAM_MUTATOR_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoUnsynchronizedSearchParamsMutation = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-unsynchronized-search-params-mutation",
    title: "Search params mutated without navigation",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "error",
    recommendation:
      "Clone the URLSearchParams value, mutate the clone, and return or pass it to setSearchParams.",
    create: (context: RuleContext) => ({
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "ArrayPattern")) return;
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;
        if (
          getImportedNameFromReactRouter(context, node.init.callee, node.init.callee.name) !==
          "useSearchParams"
        ) {
          return;
        }
        const searchParamsBinding = node.id.elements?.[0];
        const setterBinding = node.id.elements?.[1];
        if (!isNodeOfType(searchParamsBinding, "Identifier")) return;
        const searchParamsSymbol = context.scopes.symbolFor(searchParamsBinding);
        if (searchParamsSymbol === null) return;
        const setterSymbol = isNodeOfType(setterBinding, "Identifier")
          ? context.scopes.symbolFor(setterBinding)
          : null;
        const pairedSetterCalls =
          setterSymbol?.references.flatMap((reference) => {
            const callExpression = reference.identifier.parent;
            if (
              !isNodeOfType(callExpression, "CallExpression") ||
              callExpression.callee !== reference.identifier
            ) {
              return [];
            }
            const firstArgument = callExpression.arguments?.[0];
            return firstArgument && context.scopes.symbolFor(firstArgument) === searchParamsSymbol
              ? [callExpression]
              : [];
          }) ?? [];

        for (const reference of searchParamsSymbol.references) {
          const memberExpression = reference.identifier.parent;
          if (
            !isNodeOfType(memberExpression, "MemberExpression") ||
            memberExpression.object !== reference.identifier
          ) {
            continue;
          }
          const propertyName = getStaticPropertyKeyName(memberExpression, {
            allowComputedString: true,
          });
          if (propertyName === null || !REACT_ROUTER_SEARCH_PARAM_MUTATOR_NAMES.has(propertyName)) {
            continue;
          }
          const callExpression = memberExpression.parent;
          if (
            !isNodeOfType(callExpression, "CallExpression") ||
            callExpression.callee !== memberExpression
          ) {
            continue;
          }
          const mutationOwner = findEnclosingFunction(callExpression);
          if (
            pairedSetterCalls.some(
              (setterCall) => findEnclosingFunction(setterCall) === mutationOwner,
            )
          ) {
            continue;
          }
          context.report({
            node: callExpression,
            message: `${searchParamsBinding.name}.${propertyName}() mutates a stable search params object without synchronizing the URL.`,
          });
        }
      },
    }),
  }),
);
