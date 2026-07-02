import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Intermediate property names in a member-expression chain that mark
// the callee as a method on a namespaced API object rather than a
// parent callback prop. `editor.commands.setSelection(...)` is calling
// an imperative editor command, NOT handing data back to a parent.
// Same for `props.store.dispatch(...)`, `props.api.refresh(...)`,
// `editor.fonts.getShapeFontFaces(...)`, etc.
const NAMESPACED_API_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "commands",
  "actions",
  "api",
  "store",
  "service",
  "client",
  "controller",
  "manager",
  "registry",
  "dispatch",
  "queryClient",
  "fetcher",
  "loader",
  "editor",
  "model",
  "context",
  "transport",
  "channel",
  "session",
  "connection",
  "instance",
  "ref",
  "current",
  "value",
  "state",
  "vm",
  "viewModel",
  "logic",
  "selectors",
  "queries",
  "mutations",
  "effects",
  "utils",
  "helpers",
  "lib",
  // Domain-grouped APIs commonly exposed on editor / app / sdk objects.
  // `editor.fonts.X`, `editor.shapes.X`, `app.users.X`, `posthog.events.X`,
  // `analytics.events.X`, `webhooks.X`, etc.
  "fonts",
  "shapes",
  "nodes",
  "layers",
  "users",
  "accounts",
  "events",
  "logs",
  "metrics",
  "telemetry",
  "tracker",
  "tracking",
  "analytics",
  "posthog",
  "sentry",
  "auth",
  "permissions",
  "roles",
  "features",
  "flags",
  "config",
  "settings",
  "preferences",
  "storage",
  "cache",
  "history",
  "navigation",
  "router",
  "navigator",
  "scheduler",
  "queue",
  "pipeline",
  "stream",
  "socket",
  "bridge",
  "io",
  "fs",
  "db",
  "kv",
  "blob",
  "buffer",
  "cells",
  "rows",
  "columns",
  "tabs",
  "panels",
  "windows",
  "elements",
  "selections",
  "selection",
  "clipboard",
  "viewport",
  "camera",
  "scene",
  "world",
  "physics",
  "renderer",
  "renderers",
  "rendering",
  "ports",
  "messages",
  "channels",
  "subscriptions",
  "observers",
  "watchers",
  "listeners",
  "handlers",
]);

// Walks `X.Y.Z(...)` style chains looking for an intermediate property
// — or the base receiver identifier — whose name is in
// NAMESPACED_API_PROPERTY_NAMES. If found, this is a namespace-method
// call, not a parent-callback data hand-back: a destructured `router`
// prop calling `router.replace(...)` is the same redirect API as
// `props.router.replace(...)`. A bare identifier callee never matches
// (`dispatch(x)` / `onChange(x)` stay identifier-form parent callbacks).
export const isNamespacedApiCallee = (callee: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = callee;
  let hops = 0;
  while (cursor && hops < 16) {
    hops += 1;
    if (isNodeOfType(cursor, "Identifier")) {
      return hops > 1 && NAMESPACED_API_PROPERTY_NAMES.has(cursor.name);
    }
    if (!isNodeOfType(cursor, "MemberExpression")) return false;
    if (!cursor.computed && isNodeOfType(cursor.property, "Identifier")) {
      if (NAMESPACED_API_PROPERTY_NAMES.has(cursor.property.name)) return true;
    }
    cursor = cursor.object;
  }
  return false;
};
