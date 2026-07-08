import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A destination built from the current location (`router.pathname`,
// `currentUrl.pathname`, `router.asPath`) is same-page URL canonicalization —
// stripping consumed query params, normalizing a tab param — not a redirect
// that flashes the wrong page.
const CURRENT_LOCATION_PROPERTY_NAMES = new Set(["pathname", "asPath"]);

const readsCurrentLocationPath = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      CURRENT_LOCATION_PROPERTY_NAMES.has(child.property.name)
    ) {
      found = true;
    }
  });
  return found;
};

const isSamePageDestination = (destination: EsTreeNode | undefined): boolean => {
  if (!destination) return false;
  if (isNodeOfType(destination, "ObjectExpression")) {
    const pathnameProperty = (destination.properties ?? []).find(
      (property) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === "pathname",
    );
    return Boolean(
      pathnameProperty &&
      isNodeOfType(pathnameProperty, "Property") &&
      readsCurrentLocationPath(pathnameProperty.value),
    );
  }
  if (readsCurrentLocationPath(destination)) return true;
  if (isNodeOfType(destination, "Identifier")) {
    const binding = findVariableInitializer(destination, destination.name);
    if (binding?.initializer && readsCurrentLocationPath(binding.initializer)) return true;
  }
  return false;
};

// Route groups `(main)` and parallel slots `@modal` never appear in the URL;
// locale-prefix params are filled by i18n middleware, so a locale-less
// literal still targets the same page.
const LOCALE_SEGMENT_PATTERN = /^\[(locale|lng|lang|language)\]$/i;

const derivePageRoutePath = (filename: string | undefined): string | null => {
  if (!filename) return null;
  const normalized = filename.replace(/\\/g, "/");
  const appMatch = normalized.match(/(?:^|\/)app\/(.+)\/page\.[jt]sx?$/);
  const pagesMatch = appMatch
    ? null
    : normalized.match(/(?:^|\/)pages\/(.+?)(?:\/index)?\.[jt]sx?$/);
  const routePart = appMatch?.[1] ?? pagesMatch?.[1];
  if (!routePart) return null;
  const segments = routePart
    .split("/")
    .filter(
      (segment) =>
        !(segment.startsWith("(") && segment.endsWith(")")) &&
        !segment.startsWith("@") &&
        !LOCALE_SEGMENT_PATTERN.test(segment),
    );
  return `/${segments.join("/")}`;
};

const isRedirectToOwnRoute = (
  destination: EsTreeNode | undefined,
  filename: string | undefined,
): boolean => {
  if (!destination || !isNodeOfType(destination, "Literal")) return false;
  if (typeof destination.value !== "string") return false;
  const ownRoute = derivePageRoutePath(filename);
  if (!ownRoute) return false;
  const destinationPath = destination.value.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return destinationPath === ownRoute;
};

// A navigation inside a function the effect re-schedules with
// setTimeout/setInterval is an async polling subscription (payment status,
// job progress) reacting to a later external event — the doc's explicit
// no-event-handler-equivalent carve-out — not a mount-time redirect.
const collectTimerScheduledFunctionNames = (effectCallback: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(effectCallback, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (child.callee.name !== "setTimeout" && child.callee.name !== "setInterval") return;
    const scheduled = child.arguments?.[0];
    if (isNodeOfType(scheduled, "Identifier")) names.add(scheduled.name);
  });
  return names;
};

const getFunctionBindingName = (functionNode: EsTreeNode): string | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return functionNode.id.name;
  }
  const parent = functionNode.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  return null;
};

const isInsidePollingLoop = (
  navigationNode: EsTreeNode,
  effectCallback: EsTreeNode,
  timerScheduledNames: Set<string>,
): boolean => {
  if (timerScheduledNames.size === 0) return false;
  let cursor: EsTreeNode | null | undefined = navigationNode.parent;
  while (cursor && cursor !== effectCallback) {
    if (isFunctionLike(cursor)) {
      const bindingName = getFunctionBindingName(cursor);
      if (bindingName && timerScheduledNames.has(bindingName)) return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const describeClientSideNavigation = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "MemberExpression")) {
    const objectName = isNodeOfType(node.callee.object, "Identifier")
      ? node.callee.object.name
      : null;
    const methodName = isNodeOfType(node.callee.property, "Identifier")
      ? node.callee.property.name
      : null;
    if (objectName === "router" && (methodName === "push" || methodName === "replace")) {
      return `router.${methodName}() in useEffect flashes the wrong page before redirecting.`;
    }
  }

  if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
    const objectName = isNodeOfType(node.left.object, "Identifier") ? node.left.object.name : null;
    const propertyName = isNodeOfType(node.left.property, "Identifier")
      ? node.left.property.name
      : null;
    if (objectName === "window" && propertyName === "location") {
      return `window.location assignment in useEffect flashes the wrong page before redirecting.`;
    }
    if (objectName === "location" && propertyName === "href") {
      return `location.href assignment in useEffect flashes the wrong page before redirecting.`;
    }
  }

  return null;
};

// Under `output: "export"` there is no request-time server, so the default
// "use middleware / getServerSideProps" advice is impossible. Keep the
// still-valid client-side + render-time fixes and drop the server-only clause.
const STATIC_EXPORT_RECOMMENDATION =
  'Avoid redirects inside useEffect — they flash the wrong page first. Use an event handler (e.g. onClick), or call redirect() from next/navigation during render (it prerenders a client-side redirect under output: "export"). Middleware and getServerSideProps redirects aren\'t available in a static export.';

export const nextjsNoClientSideRedirect = defineRule({
  id: "nextjs-no-client-side-redirect",
  title: "Client-side redirect for navigation",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Avoid redirects inside useEffect. Use an event handler, middleware, or server-side redirect (App Router: redirect() from next/navigation; Pages Router: getServerSideProps redirect)",
  recommendationFor: (hasCapability) =>
    hasCapability("nextjs:static-export") ? STATIC_EXPORT_RECOMMENDATION : undefined,
  create: (context: RuleContext) => {
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
        const timerScheduledNames = collectTimerScheduledFunctionNames(callback);
        walkAst(callback, (child: EsTreeNode) => {
          // Stop at non-invoked nested function boundaries: a navigation inside
          // an event handler registered in the effect runs on a later user
          // interaction, not as part of the mount-time effect, so it must not
          // be flagged — but IIFEs, called local functions, and promise-chain
          // callbacks of effect-body calls do run on mount.
          if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child)) {
            return false;
          }

          const navigationDescription = describeClientSideNavigation(child);
          if (navigationDescription) {
            if (isNodeOfType(child, "CallExpression")) {
              const destination = child.arguments?.[0];
              if (isSamePageDestination(destination)) return;
              if (isRedirectToOwnRoute(destination, context.filename)) return;
            }
            if (isInsidePollingLoop(child, callback, timerScheduledNames)) return;
            context.report({
              node: child,
              message: navigationDescription,
            });
          }
        });
      },
    };
  },
});
