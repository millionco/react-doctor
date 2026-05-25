// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { queryMutationMissingInvalidation } from "./../rules/tanstack-query/query-mutation-missing-invalidation.js";
import { queryNoQueryInEffect } from "./../rules/tanstack-query/query-no-query-in-effect.js";
import { queryNoRestDestructuring } from "./../rules/tanstack-query/query-no-rest-destructuring.js";
import { queryNoUseQueryForMutation } from "./../rules/tanstack-query/query-no-use-query-for-mutation.js";
import { queryNoVoidQueryFn } from "./../rules/tanstack-query/query-no-void-query-fn.js";
import { queryStableQueryClient } from "./../rules/tanstack-query/query-stable-query-client.js";

export const TanstackQueryRuleEntries = [
  {
    key: "react-doctor/query-mutation-missing-invalidation",
    id: "query-mutation-missing-invalidation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryMutationMissingInvalidation,
      framework: "tanstack-query",
      category: "TanStack Query",
      requires: [
        ...new Set(["tanstack-query", ...(queryMutationMissingInvalidation.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/query-no-query-in-effect",
    id: "query-no-query-in-effect",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoQueryInEffect,
      framework: "tanstack-query",
      category: "TanStack Query",
      requires: [...new Set(["tanstack-query", ...(queryNoQueryInEffect.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/query-no-rest-destructuring",
    id: "query-no-rest-destructuring",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoRestDestructuring,
      framework: "tanstack-query",
      category: "TanStack Query",
      requires: [...new Set(["tanstack-query", ...(queryNoRestDestructuring.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/query-no-usequery-for-mutation",
    id: "query-no-usequery-for-mutation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoUseQueryForMutation,
      framework: "tanstack-query",
      category: "TanStack Query",
      requires: [...new Set(["tanstack-query", ...(queryNoUseQueryForMutation.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/query-no-void-query-fn",
    id: "query-no-void-query-fn",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryNoVoidQueryFn,
      framework: "tanstack-query",
      category: "TanStack Query",
      requires: [...new Set(["tanstack-query", ...(queryNoVoidQueryFn.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/query-stable-query-client",
    id: "query-stable-query-client",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-query",
    category: "TanStack Query",
    severity: "warn",
    rule: {
      ...queryStableQueryClient,
      framework: "tanstack-query",
      category: "TanStack Query",
      requires: [...new Set(["tanstack-query", ...(queryStableQueryClient.requires ?? [])])],
    },
  },
] as const;
