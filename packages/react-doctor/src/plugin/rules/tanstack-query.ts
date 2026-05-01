import {
  EFFECT_HOOK_NAMES,
  MUTATING_HTTP_METHODS,
  QUERY_CACHE_UPDATE_METHODS,
  STABLE_HOOK_WRAPPERS,
  TANSTACK_MUTATION_HOOKS,
  TANSTACK_QUERY_CLIENT_CLASS,
  TANSTACK_QUERY_HOOKS,
  UPPERCASE_PATTERN,
} from "../constants.js";
import { getEffectCallback, isHookCall, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const queryStableQueryClient: Rule = {
  create: (context: RuleContext) => {
    let componentDepth = 0;
    let stableHookDepth = 0;

    return {
      FunctionDeclaration(node: EsTreeNode) {
        if (node.id?.name && UPPERCASE_PATTERN.test(node.id.name)) {
          componentDepth++;
        }
      },
      "FunctionDeclaration:exit"(node: EsTreeNode) {
        if (node.id?.name && UPPERCASE_PATTERN.test(node.id.name)) {
          componentDepth--;
        }
      },
      VariableDeclarator(node: EsTreeNode) {
        if (
          node.id?.type === "Identifier" &&
          UPPERCASE_PATTERN.test(node.id.name) &&
          (node.init?.type === "ArrowFunctionExpression" ||
            node.init?.type === "FunctionExpression")
        ) {
          componentDepth++;
        }
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (
          node.id?.type === "Identifier" &&
          UPPERCASE_PATTERN.test(node.id.name) &&
          (node.init?.type === "ArrowFunctionExpression" ||
            node.init?.type === "FunctionExpression")
        ) {
          componentDepth--;
        }
      },
      CallExpression(node: EsTreeNode) {
        if (isHookCall(node, STABLE_HOOK_WRAPPERS)) {
          stableHookDepth++;
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (isHookCall(node, STABLE_HOOK_WRAPPERS)) {
          stableHookDepth = Math.max(0, stableHookDepth - 1);
        }
      },
      NewExpression(node: EsTreeNode) {
        if (componentDepth <= 0) return;
        if (stableHookDepth > 0) return;
        if (node.callee?.type !== "Identifier" || node.callee.name !== TANSTACK_QUERY_CLIENT_CLASS)
          return;

        context.report({
          node,
          message:
            "new QueryClient() inside a component — creates a new cache on every render. Move to module scope or wrap in useState(() => new QueryClient())",
        });
      },
    };
  },
};

export const queryNoRestDestructuring: Rule = {
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNode) {
      if (node.id?.type !== "ObjectPattern") return;
      if (!node.init || node.init.type !== "CallExpression") return;

      const calleeName = node.init.callee?.type === "Identifier" ? node.init.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const hasRestElement = node.id.properties?.some(
        (property: EsTreeNode) => property.type === "RestElement",
      );

      if (hasRestElement) {
        context.report({
          node: node.id,
          message: `Rest destructuring on ${calleeName}() result — subscribes to all fields and causes unnecessary re-renders. Destructure only the fields you need`,
        });
      }
    },
  }),
};

export const queryNoVoidQueryFn: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const calleeName = node.callee?.type === "Identifier" ? node.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return;

      const queryFnProperty = optionsArgument.properties?.find(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "queryFn",
      );

      if (!queryFnProperty?.value) return;

      const queryFnValue = queryFnProperty.value;

      if (
        queryFnValue.type === "ArrowFunctionExpression" &&
        queryFnValue.body?.type !== "BlockStatement"
      ) {
        return;
      }

      if (
        queryFnValue.type === "ArrowFunctionExpression" ||
        queryFnValue.type === "FunctionExpression"
      ) {
        const body = queryFnValue.body;
        if (body?.type !== "BlockStatement") return;

        const statements = body.body ?? [];
        if (statements.length === 0) {
          context.report({
            node: queryFnProperty,
            message:
              "Empty queryFn — query functions must return a value. Use the enabled option to conditionally disable the query instead",
          });
        }
      }
    },
  }),
};

export const queryNoQueryInEffect: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      walkAst(callback, (child: EsTreeNode) => {
        if (child.type !== "CallExpression") return;

        const calleeName = child.callee?.type === "Identifier" ? child.callee.name : null;

        if (calleeName === "refetch") {
          context.report({
            node: child,
            message:
              "refetch() inside useEffect — React Query manages refetching automatically. Use queryKey dependencies or the enabled option instead",
          });
        }
      });
    },
  }),
};

export const queryMutationMissingInvalidation: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const calleeName = node.callee?.type === "Identifier" ? node.callee.name : null;

      if (!calleeName || !TANSTACK_MUTATION_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return;

      const hasMutationFn = optionsArgument.properties?.some(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "mutationFn",
      );

      if (!hasMutationFn) return;

      let hasCacheUpdate = false;
      walkAst(optionsArgument, (child: EsTreeNode) => {
        if (hasCacheUpdate) return false;
        if (
          child.type === "CallExpression" &&
          child.callee?.type === "MemberExpression" &&
          child.callee.property?.type === "Identifier" &&
          QUERY_CACHE_UPDATE_METHODS.has(child.callee.property.name)
        ) {
          hasCacheUpdate = true;
          return false;
        }
      });

      if (!hasCacheUpdate) {
        context.report({
          node,
          message:
            "useMutation without a cache update — stale data may remain after the mutation. Call queryClient.invalidateQueries / setQueryData / resetQueries / refetchQueries inside onSuccess (or trigger a router refresh)",
        });
      }
    },
  }),
};

export const queryNoUseQueryForMutation: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      const calleeName = node.callee?.type === "Identifier" ? node.callee.name : null;

      if (!calleeName || !TANSTACK_QUERY_HOOKS.has(calleeName)) return;

      const optionsArgument = node.arguments?.[0];
      if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return;

      const queryFnProperty = optionsArgument.properties?.find(
        (property: EsTreeNode) =>
          property.type === "Property" &&
          property.key?.type === "Identifier" &&
          property.key.name === "queryFn",
      );

      if (!queryFnProperty?.value) return;

      let hasMutatingFetch = false;
      walkAst(queryFnProperty.value, (child: EsTreeNode) => {
        if (hasMutatingFetch) return;
        if (child.type !== "CallExpression") return;
        if (child.callee?.type !== "Identifier" || child.callee.name !== "fetch") return;

        const optionsArg = child.arguments?.[1];
        if (!optionsArg || optionsArg.type !== "ObjectExpression") return;

        const methodProperty = optionsArg.properties?.find(
          (property: EsTreeNode) =>
            property.type === "Property" &&
            property.key?.type === "Identifier" &&
            property.key.name === "method" &&
            property.value?.type === "Literal" &&
            typeof property.value.value === "string" &&
            MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase()),
        );

        if (methodProperty) hasMutatingFetch = true;
      });

      if (hasMutatingFetch) {
        context.report({
          node,
          message: `${calleeName}() with a mutating fetch (POST/PUT/DELETE) — use useMutation() instead, which provides onSuccess/onError callbacks and doesn't auto-refetch`,
        });
      }
    },
  }),
};
