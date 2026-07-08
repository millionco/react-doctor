import { MUTATING_HTTP_METHODS } from "../../constants/library.js";
import { TANSTACK_QUERY_HOOKS } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Path-segment match: `/graphql`, `${BASE}/graphql`, `graphql?op=x` — but NOT
// a REST URL that merely contains the substring (`/api/graphql-schemas/123`).
const GRAPHQL_URL_SEGMENT_PATTERN = /(^|\/)graphql(\/|\?|#|$)/i;

// GraphQL is queried over HTTP POST by spec, so POST is the only method the
// GraphQL exemption may sanction — a DELETE/PUT/PATCH to `/graphql` is not a
// spec-shaped GraphQL read.
const GRAPHQL_SANCTIONED_HTTP_METHOD = "POST";

// A statically visible GraphQL operation text that starts with the `mutation`
// keyword — a POST carrying one is a write, not a read.
const GRAPHQL_MUTATION_TEXT_PATTERN = /^\s*mutation\b/;

// A path segment announcing an RPC-style read (`/zaps/get-zap-data`,
// `/search`, a `/quote` endpoint): POST-as-read APIs name their read
// endpoints this way because the query parameters ride in the body.
const READ_NAMED_URL_SEGMENT_PATTERN = /(^|\/)(get|list|search|query|quote)([-_.]|\/|\?|#|$)/i;

// True when any static text of a URL expression matches the pattern.
// Recognizes a string literal, a template literal's static segments
// (`\`${BASE}/graphql\``), and a const-resolved identifier
// (`const GRAPHQL_URL = "/graphql"`).
const urlStaticTextMatches = (
  urlArgument: EsTreeNode | null | undefined,
  pattern: RegExp,
): boolean => {
  if (!urlArgument) return false;
  if (
    isNodeOfType(urlArgument, "Literal") &&
    typeof urlArgument.value === "string" &&
    pattern.test(urlArgument.value)
  ) {
    return true;
  }
  if (isNodeOfType(urlArgument, "TemplateLiteral")) {
    return (urlArgument.quasis ?? []).some(
      (quasi) =>
        isNodeOfType(quasi, "TemplateElement") &&
        typeof quasi.value?.raw === "string" &&
        pattern.test(quasi.value.raw),
    );
  }
  if (isNodeOfType(urlArgument, "Identifier")) {
    const binding = findVariableInitializer(urlArgument, urlArgument.name);
    if (binding?.initializer) return urlStaticTextMatches(binding.initializer, pattern);
  }
  return false;
};

const isGraphqlUrl = (urlArgument: EsTreeNode | null | undefined): boolean =>
  urlStaticTextMatches(urlArgument, GRAPHQL_URL_SEGMENT_PATTERN);

// A query configured with a live `refetchInterval` is deliberate polling —
// the author wants the request re-fired on a timer, which is incompatible
// with "this is a mutation" (a POST-as-read RPC being re-read). Literal
// `false` / `0` disable polling and don't vouch for anything.
const hasPollingRefetchInterval = (
  optionsArgument: EsTreeNodeOfType<"ObjectExpression">,
): boolean =>
  (optionsArgument.properties ?? []).some((property: EsTreeNode) => {
    if (
      !isNodeOfType(property, "Property") ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name !== "refetchInterval" ||
      !property.value
    ) {
      return false;
    }
    if (isNodeOfType(property.value, "Literal")) {
      return property.value.value !== false && property.value.value !== 0;
    }
    return true;
  });

const getStaticFetchMethod = (
  fetchOptions: EsTreeNodeOfType<"ObjectExpression">,
): string | null => {
  const methodProperty = fetchOptions.properties?.find(
    (property: EsTreeNode) =>
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "method",
  );
  if (!methodProperty || !isNodeOfType(methodProperty, "Property")) return null;
  if (
    isNodeOfType(methodProperty.value, "Literal") &&
    typeof methodProperty.value.value === "string"
  ) {
    return methodProperty.value.value.toUpperCase();
  }
  return null;
};

const hasInlineGraphqlMutationBody = (
  fetchOptions: EsTreeNodeOfType<"ObjectExpression">,
): boolean => {
  const bodyProperty = fetchOptions.properties?.find(
    (property: EsTreeNode) =>
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "body",
  );
  if (!bodyProperty || !isNodeOfType(bodyProperty, "Property") || !bodyProperty.value) return false;

  let containsMutationText = false;
  walkAst(bodyProperty.value, (child: EsTreeNode) => {
    if (containsMutationText) return false;
    if (
      isNodeOfType(child, "Literal") &&
      typeof child.value === "string" &&
      GRAPHQL_MUTATION_TEXT_PATTERN.test(child.value)
    ) {
      containsMutationText = true;
      return false;
    }
    if (
      isNodeOfType(child, "TemplateElement") &&
      typeof child.value?.raw === "string" &&
      GRAPHQL_MUTATION_TEXT_PATTERN.test(child.value.raw)
    ) {
      containsMutationText = true;
      return false;
    }
  });
  return containsMutationText;
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

      if (hasPollingRefetchInterval(optionsArgument)) return;

      let hasMutatingFetch = false;
      walkAst(queryFnProperty.value, (child: EsTreeNode) => {
        if (hasMutatingFetch) return;
        if (!isNodeOfType(child, "CallExpression")) return;
        if (!isNodeOfType(child.callee, "Identifier") || child.callee.name !== "fetch") return;

        const fetchOptionsArgument = child.arguments?.[1];
        if (!fetchOptionsArgument || !isNodeOfType(fetchOptionsArgument, "ObjectExpression"))
          return;

        const resolvedMethod = getStaticFetchMethod(fetchOptionsArgument);
        if (!resolvedMethod || !MUTATING_HTTP_METHODS.has(resolvedMethod)) return;

        // A POST to a `/graphql` endpoint inside `useQuery` is a legitimate
        // read — unless the body carries a statically visible `mutation`.
        if (
          resolvedMethod === GRAPHQL_SANCTIONED_HTTP_METHOD &&
          isGraphqlUrl(child.arguments?.[0]) &&
          !hasInlineGraphqlMutationBody(fetchOptionsArgument)
        ) {
          return;
        }

        // A POST to a read-named RPC endpoint (`/zaps/get-zap-data`, a
        // `/quote` API) is a read whose parameters ride in the body, not a
        // write. Only POST gets this pass — DELETE/PUT/PATCH stay writes
        // whatever the path says.
        if (
          resolvedMethod === "POST" &&
          urlStaticTextMatches(child.arguments?.[0], READ_NAMED_URL_SEGMENT_PATTERN)
        ) {
          return;
        }

        hasMutatingFetch = true;
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
