// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { serverAfterNonblocking } from "./../rules/server/server-after-nonblocking.js";
import { serverAuthActions } from "./../rules/server/server-auth-actions.js";
import { serverCacheWithObjectLiteral } from "./../rules/server/server-cache-with-object-literal.js";
import { serverDedupProps } from "./../rules/server/server-dedup-props.js";
import { serverFetchWithoutRevalidate } from "./../rules/server/server-fetch-without-revalidate.js";
import { serverHoistStaticIo } from "./../rules/server/server-hoist-static-io.js";
import { serverNoMutableModuleState } from "./../rules/server/server-no-mutable-module-state.js";
import { serverSequentialIndependentAwait } from "./../rules/server/server-sequential-independent-await.js";

export const ServerRuleEntries = [
  {
    key: "react-doctor/server-after-nonblocking",
    id: "server-after-nonblocking",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverAfterNonblocking,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverAfterNonblocking.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-auth-actions",
    id: "server-auth-actions",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "error",
    rule: {
      ...serverAuthActions,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverAuthActions.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-cache-with-object-literal",
    id: "server-cache-with-object-literal",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverCacheWithObjectLiteral,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverCacheWithObjectLiteral.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-dedup-props",
    id: "server-dedup-props",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverDedupProps,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverDedupProps.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-fetch-without-revalidate",
    id: "server-fetch-without-revalidate",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverFetchWithoutRevalidate,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverFetchWithoutRevalidate.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-hoist-static-io",
    id: "server-hoist-static-io",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverHoistStaticIo,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverHoistStaticIo.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-no-mutable-module-state",
    id: "server-no-mutable-module-state",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "error",
    rule: {
      ...serverNoMutableModuleState,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverNoMutableModuleState.tags ?? [])])],
    },
  },
  {
    key: "react-doctor/server-sequential-independent-await",
    id: "server-sequential-independent-await",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Server",
    severity: "warn",
    rule: {
      ...serverSequentialIndependentAwait,
      framework: "global",
      category: "Server",
      tags: [...new Set(["server-action", ...(serverSequentialIndependentAwait.tags ?? [])])],
    },
  },
] as const;
