// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { tanstackStartGetMutation } from "./../rules/tanstack-start/tanstack-start-get-mutation.js";
import { tanstackStartLoaderParallelFetch } from "./../rules/tanstack-start/tanstack-start-loader-parallel-fetch.js";
import { tanstackStartMissingHeadContent } from "./../rules/tanstack-start/tanstack-start-missing-head-content.js";
import { tanstackStartNoAnchorElement } from "./../rules/tanstack-start/tanstack-start-no-anchor-element.js";
import { tanstackStartNoDirectFetchInLoader } from "./../rules/tanstack-start/tanstack-start-no-direct-fetch-in-loader.js";
import { tanstackStartNoDynamicServerFnImport } from "./../rules/tanstack-start/tanstack-start-no-dynamic-server-fn-import.js";
import { tanstackStartNoNavigateInRender } from "./../rules/tanstack-start/tanstack-start-no-navigate-in-render.js";
import { tanstackStartNoSecretsInLoader } from "./../rules/tanstack-start/tanstack-start-no-secrets-in-loader.js";
import { tanstackStartNoUseServerInHandler } from "./../rules/tanstack-start/tanstack-start-no-use-server-in-handler.js";
import { tanstackStartNoUseEffectFetch } from "./../rules/tanstack-start/tanstack-start-no-use-effect-fetch.js";
import { tanstackStartRedirectInTryCatch } from "./../rules/tanstack-start/tanstack-start-redirect-in-try-catch.js";
import { tanstackStartRoutePropertyOrder } from "./../rules/tanstack-start/tanstack-start-route-property-order.js";
import { tanstackStartServerFnMethodOrder } from "./../rules/tanstack-start/tanstack-start-server-fn-method-order.js";
import { tanstackStartServerFnValidateInput } from "./../rules/tanstack-start/tanstack-start-server-fn-validate-input.js";

export const TanstackStartRuleEntries = [
  {
    key: "react-doctor/tanstack-start-get-mutation",
    id: "tanstack-start-get-mutation",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "Security",
    severity: "warn",
    rule: {
      ...tanstackStartGetMutation,
      framework: "tanstack-start",
      category: "Security",
      requires: [...new Set(["tanstack-start", ...(tanstackStartGetMutation.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/tanstack-start-loader-parallel-fetch",
    id: "tanstack-start-loader-parallel-fetch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "Performance",
    severity: "warn",
    rule: {
      ...tanstackStartLoaderParallelFetch,
      framework: "tanstack-start",
      category: "Performance",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartLoaderParallelFetch.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-missing-head-content",
    id: "tanstack-start-missing-head-content",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartMissingHeadContent,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartMissingHeadContent.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-anchor-element",
    id: "tanstack-start-no-anchor-element",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoAnchorElement,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [...new Set(["tanstack-start", ...(tanstackStartNoAnchorElement.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-direct-fetch-in-loader",
    id: "tanstack-start-no-direct-fetch-in-loader",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoDirectFetchInLoader,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartNoDirectFetchInLoader.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-dynamic-server-fn-import",
    id: "tanstack-start-no-dynamic-server-fn-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartNoDynamicServerFnImport,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartNoDynamicServerFnImport.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-navigate-in-render",
    id: "tanstack-start-no-navigate-in-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoNavigateInRender,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartNoNavigateInRender.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-secrets-in-loader",
    id: "tanstack-start-no-secrets-in-loader",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "Security",
    severity: "error",
    rule: {
      ...tanstackStartNoSecretsInLoader,
      framework: "tanstack-start",
      category: "Security",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartNoSecretsInLoader.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-use-server-in-handler",
    id: "tanstack-start-no-use-server-in-handler",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartNoUseServerInHandler,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartNoUseServerInHandler.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-no-useeffect-fetch",
    id: "tanstack-start-no-useeffect-fetch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartNoUseEffectFetch,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [...new Set(["tanstack-start", ...(tanstackStartNoUseEffectFetch.requires ?? [])])],
    },
  },
  {
    key: "react-doctor/tanstack-start-redirect-in-try-catch",
    id: "tanstack-start-redirect-in-try-catch",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartRedirectInTryCatch,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartRedirectInTryCatch.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-route-property-order",
    id: "tanstack-start-route-property-order",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartRoutePropertyOrder,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartRoutePropertyOrder.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-server-fn-method-order",
    id: "tanstack-start-server-fn-method-order",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "error",
    rule: {
      ...tanstackStartServerFnMethodOrder,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartServerFnMethodOrder.requires ?? [])]),
      ],
    },
  },
  {
    key: "react-doctor/tanstack-start-server-fn-validate-input",
    id: "tanstack-start-server-fn-validate-input",
    source: "react-doctor",
    originallyExternal: false,
    framework: "tanstack-start",
    category: "TanStack Start",
    severity: "warn",
    rule: {
      ...tanstackStartServerFnValidateInput,
      framework: "tanstack-start",
      category: "TanStack Start",
      requires: [
        ...new Set(["tanstack-start", ...(tanstackStartServerFnValidateInput.requires ?? [])]),
      ],
    },
  },
] as const;
