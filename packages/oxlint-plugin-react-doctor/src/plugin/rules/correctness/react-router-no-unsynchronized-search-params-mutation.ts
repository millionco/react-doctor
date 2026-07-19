import { REACT_ROUTER_SEARCH_PARAM_MUTATOR_NAMES } from "../../constants/react-router.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const isInlineCallCallback = (node: EsTreeNode): boolean =>
  isFunctionLike(node) &&
  isNodeOfType(node.parent, "CallExpression") &&
  node.parent.arguments?.some((argument) => argument === node) === true;

const findSearchParamsOperationOwner = (node: EsTreeNode): EsTreeNode | null => {
  let owner = findEnclosingFunction(node);
  while (owner && isInlineCallCallback(owner)) {
    owner = findEnclosingFunction(owner);
  }
  return owner;
};

const isReturnedBeforeFunctionBoundary = (node: EsTreeNode): boolean => {
  let cursor = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "ReturnStatement")) return true;
    if (isFunctionLike(cursor)) return false;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const findContainingCallBeforeFunctionBoundary = (
  node: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let cursor = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "CallExpression")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const isProvenNavigateCall = (
  context: RuleContext,
  node: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const navigateSymbol = context.scopes.symbolFor(node.callee);
  if (navigateSymbol === null) return false;
  const initializer = getDirectUnreassignedInitializer(navigateSymbol);
  return (
    isNodeOfType(initializer, "CallExpression") &&
    isNodeOfType(initializer.callee, "Identifier") &&
    getImportedNameFromReactRouter(context, initializer.callee, initializer.callee.name) ===
      "useNavigate"
  );
};

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
        const setterCalls =
          setterSymbol?.references.flatMap((reference) => {
            const callExpression = reference.identifier.parent;
            if (
              !isNodeOfType(callExpression, "CallExpression") ||
              callExpression.callee !== reference.identifier
            ) {
              return [];
            }
            return [callExpression];
          }) ?? [];
        const serializationCalls = searchParamsSymbol.references.flatMap((reference) => {
          const memberExpression = reference.identifier.parent;
          if (
            !isNodeOfType(memberExpression, "MemberExpression") ||
            memberExpression.object !== reference.identifier ||
            getStaticPropertyKeyName(memberExpression, { allowComputedString: true }) !== "toString"
          ) {
            return [];
          }
          const callExpression = memberExpression.parent;
          return isNodeOfType(callExpression, "CallExpression") &&
            callExpression.callee === memberExpression
            ? [callExpression]
            : [];
        });

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
          const mutationOwner = findSearchParamsOperationOwner(callExpression);
          if (
            setterCalls.some(
              (setterCall) => findSearchParamsOperationOwner(setterCall) === mutationOwner,
            )
          ) {
            continue;
          }
          const isSerializedForNavigation = serializationCalls.some((serializationCall) => {
            if (findSearchParamsOperationOwner(serializationCall) !== mutationOwner) return false;
            if (isReturnedBeforeFunctionBoundary(serializationCall)) return true;
            const containingCall = findContainingCallBeforeFunctionBoundary(serializationCall);
            return containingCall !== null && isProvenNavigateCall(context, containingCall);
          });
          if (isSerializedForNavigation) continue;
          context.report({
            node: callExpression,
            message: `${searchParamsBinding.name}.${propertyName}() mutates a stable search params object without synchronizing the URL.`,
          });
        }
      },
    }),
  }),
);
