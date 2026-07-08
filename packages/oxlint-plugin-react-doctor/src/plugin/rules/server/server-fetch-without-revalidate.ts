import { defineRule } from "../../utils/define-rule.js";
import { isInProjectDirectory } from "../../utils/is-in-project-directory.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isMutatingFetchCall } from "../../utils/find-side-effect.js";
import { NEXTJS_SOURCE_FILE_EXTENSION_GROUP } from "../../constants/nextjs.js";

const isFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  return isNodeOfType(node.callee, "Identifier") && node.callee.name === "fetch";
};

const getPropertyKeyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property")) return null;
  if (!property.computed && isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

const objectExpressionHasCachingConfig = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): boolean =>
  (objectExpression.properties ?? []).some((property) => {
    const keyName = getPropertyKeyName(property);
    return keyName === "cache" || keyName === "next";
  });

const objectExpressionHasSpread = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): boolean =>
  (objectExpression.properties ?? []).some((property) => isNodeOfType(property, "SpreadElement"));

// HACK: in Next.js <15 (App Router), `fetch(url)` inside a Server Component
// or route handler is cached *forever* by default unless the response
// is dynamic. The fix is to set `next: { revalidate: <seconds> }` (or
// `cache: "no-store"` for fully dynamic data, or `next: { tags: [..., "test-noise"] }`
// for tag-based invalidation). Forgetting this is a common silent-stale
// data bug. Next.js 15+ changed the default to `no-store`, so the rule
// is gated with `disabledWhen: ["nextjs:15"]`.
//
// Heuristic: `fetch(url)` in an App Router file (`app/.../route.*`,
// `app/.../page.*`, `app/.../layout.*`) without a config object —
// or with a config object that omits both `cache` and
// `next.revalidate`/`next.tags`. We can't reliably know "this is a
// Server Component" from the AST alone, so we approximate by:
//   1. Path contains `/app/` AND filename matches one of the App Router
//      file shapes (route|page|layout|template|loading|error|default
//      with .ts(x)? extension), AND
//   2. The file does not start with a `"use client"` directive, AND
//   3. The path does not pass through `node_modules/` or `dist/`
//      (vendored or built code).
const APP_ROUTER_FILE_PATTERN = new RegExp(
  `/app/(?:[^/]+/)*(?:route|page|layout|template|loading|error|default)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

const NON_PROJECT_PATH_PATTERN = /\/(?:node_modules|dist|build|\.next)\//;

// Remix / React Router also use an `app/` directory with `route.tsx`
// files, but their `fetch` has standard browser/undici semantics — the
// Next.js data-cache never applies there.
const REMIX_IMPORT_SOURCE_PATTERN = /^(?:@remix-run\/|@react-router\/|react-router(?:-dom)?$)/;

const programImportsRemixRouter = (programNode: EsTreeNodeOfType<"Program">): boolean =>
  (programNode.body ?? []).some(
    (statement) =>
      isNodeOfType(statement, "ImportDeclaration") &&
      !isTypeOnlyImport(statement) &&
      typeof statement.source?.value === "string" &&
      REMIX_IMPORT_SOURCE_PATTERN.test(statement.source.value),
  );

// `fetch(new URL("./font.ttf", import.meta.url))` is the documented
// `next/og` pattern for loading a bundled static asset — caching it
// forever is the intended behavior, so "stale data" never applies.
const isImportMetaUrlAssetArgument = (urlArg: EsTreeNode | undefined): boolean => {
  if (!isNodeOfType(urlArg, "NewExpression")) return false;
  if (!isNodeOfType(urlArg.callee, "Identifier") || urlArg.callee.name !== "URL") return false;
  const baseArg = urlArg.arguments?.[1];
  return (
    isNodeOfType(baseArg, "MemberExpression") &&
    isNodeOfType(baseArg.object, "MetaProperty") &&
    isNodeOfType(baseArg.property, "Identifier") &&
    baseArg.property.name === "url"
  );
};

export const serverFetchWithoutRevalidate = defineRule({
  id: "server-fetch-without-revalidate",
  title: "Fetch without revalidate",
  severity: "warn",
  disabledWhen: ["nextjs:15", "nextjs:static-export"],
  recommendation:
    'Pass `{ next: { revalidate: <seconds> } }` (or `cache: "no-store"`) so old data doesn\'t stick around.',
  create: (context: RuleContext) => {
    let isServerSideFile = false;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        const filename = normalizeFilename(context.filename ?? "");
        if (!isInProjectDirectory(context, "app") || !APP_ROUTER_FILE_PATTERN.test(filename)) {
          isServerSideFile = false;
          return;
        }
        if (NON_PROJECT_PATH_PATTERN.test(filename)) {
          isServerSideFile = false;
          return;
        }
        const hasUseClient = (node.body ?? []).some(
          (statement: EsTreeNode) =>
            isNodeOfType(statement, "ExpressionStatement") &&
            isNodeOfType(statement.expression, "Literal") &&
            statement.expression.value === "use client",
        );
        isServerSideFile = !hasUseClient && !programImportsRemixRouter(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isServerSideFile) return;
        if (!isFetchCall(node)) return;
        // Next.js only caches GET requests, so a mutating fetch
        // (POST/PUT/PATCH/DELETE) can never serve stale cached data.
        if (isMutatingFetchCall(node)) return;

        const optionsArg = node.arguments?.[1];
        if (optionsArg) {
          // Only an inline `{ … }` is transparent enough to prove the
          // caching config is missing. A non-literal options arg
          // (`fetch(url, options)`) may carry `next: { revalidate }` we
          // can't see through, so abstain instead of risking a false
          // positive. The same goes for a spread inside the object
          // (`{ ...cacheOptions, headers }`) — the spread source may carry
          // the config, so abstain unless an explicit `cache`/`next`
          // property already decides.
          if (!isNodeOfType(optionsArg, "ObjectExpression")) return;
          if (objectExpressionHasCachingConfig(optionsArg)) return;
          if (objectExpressionHasSpread(optionsArg)) return;
        }

        const urlArg = node.arguments?.[0];
        if (isImportMetaUrlAssetArgument(urlArg)) return;
        const urlText =
          isNodeOfType(urlArg, "Literal") && typeof urlArg.value === "string"
            ? `"${urlArg.value}"`
            : "url";
        context.report({
          node,
          message: `fetch(${urlText}) is cached forever by default, so your users can see stale data.`,
        });
      },
    };
  },
});
