import { MUTATING_HTTP_METHODS } from "../../constants/library.js";
import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const GRAPHQL_URL_PATTERN = /graphql/i;

// True when the static text of a URL expression names a GraphQL endpoint.
// GraphQL is queried over HTTP POST by spec, so a `POST` to `/graphql` inside
// `useQuery` is a legitimate read, not a mutation. Recognizes a string literal,
// a template literal with a static `/graphql` segment (`\`${BASE}/graphql\``),
// and a const-resolved identifier (`const GRAPHQL_URL = "/graphql"`).
const isGraphqlUrl = (urlArgument: EsTreeNode | null | undefined): boolean => {
  if (!urlArgument) return false;
  if (
    isNodeOfType(urlArgument, "Literal") &&
    typeof urlArgument.value === "string" &&
    GRAPHQL_URL_PATTERN.test(urlArgument.value)
  ) {
    return true;
  }
  if (isNodeOfType(urlArgument, "TemplateLiteral")) {
    return (urlArgument.quasis ?? []).some(
      (quasi) =>
        isNodeOfType(quasi, "TemplateElement") &&
        typeof quasi.value?.raw === "string" &&
        GRAPHQL_URL_PATTERN.test(quasi.value.raw),
    );
  }
  if (isNodeOfType(urlArgument, "Identifier")) {
    const binding = findVariableInitializer(urlArgument, urlArgument.name);
    if (binding?.initializer) return isGraphqlUrl(binding.initializer);
  }
  return false;
};

export const queryNoUseQueryForMutation = defineRule({
  id: "query-no-usequery-for-mutation",
  title: "useQuery used for mutation",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `useMutation()` for POST/PUT/DELETE. It gives onSuccess/onError callbacks, doesn't auto-refetch, and models writes correctly.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return;

      const queryFnProperty = optionsArgument.properties?.find(
        (property: EsTreeNode) =>
          isNodeOfType(property, "Property") &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === "queryFn",
      );

      if (!queryFnProperty || !isNodeOfType(queryFnProperty, "Property") || !queryFnProperty.value)
        return;

      let hasMutatingFetch = false;
      walkAst(queryFnProperty.value, (child: EsTreeNode) => {
        if (hasMutatingFetch) return;
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isNodeOfType(child.callee, "Identifier") || child.callee.name !== "fetch") return;

        // GraphQL is queried over HTTP POST by spec — a `POST` to a `/graphql`
        // endpoint inside a `useQuery` is a legitimate read, not a mutation.
        if (isGraphqlUrl(child.arguments?.[0])) return;

        const optionsArg = child.arguments?.[1];
        if (!optionsArg || !isNodeOfType(optionsArg, "ObjectExpression")) return;

        const methodProperty = optionsArg.properties?.find(
          (property: EsTreeNode) =>
            isNodeOfType(property, "Property") &&
            isNodeOfType(property.key, "Identifier") &&
            property.key.name === "method" &&
            isNodeOfType(property.value, "Literal") &&
            typeof property.value.value === "string" &&
            MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase()),
        );

        if (methodProperty) hasMutatingFetch = true;
      });

      if (hasMutatingFetch) {
        context.report({
          node,
          message: `${calleeName}() auto-refetches, so this mutating fetch (POST/PUT/DELETE) can fire repeatedly.`,
        });
      }
    },
  }),
});
