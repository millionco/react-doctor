import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isFetchCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  return node.callee?.type === "Identifier" && node.callee.name === "fetch";
};

const objectExpressionHasNextRevalidate = (objectExpression: EsTreeNode): boolean => {
  if (objectExpression.type !== "ObjectExpression") return false;
  for (const property of objectExpression.properties ?? []) {
    if (property.type !== "Property") continue;
    if (property.key?.type !== "Identifier") continue;
    if (property.key.name === "cache") return true;
    if (property.key.name !== "next") continue;
    if (property.value?.type !== "ObjectExpression") return true;
    for (const innerProperty of property.value.properties ?? []) {
      if (innerProperty.type !== "Property") continue;
      if (innerProperty.key?.type !== "Identifier") continue;
      if (innerProperty.key.name === "revalidate" || innerProperty.key.name === "tags") {
        return true;
      }
    }
    return true;
  }
  return false;
};

// HACK: in Next.js (App Router), `fetch(url)` inside a Server Component
// or route handler is cached *forever* by default unless the response
// is dynamic. The fix is to set `next: { revalidate: <seconds> }` (or
// `cache: "no-store"` for fully dynamic data, or `next: { tags: [...] }`
// for tag-based invalidation). Forgetting this is a common silent-stale
// data bug.
//
// Heuristic: `fetch(url)` in an App Router file (`app/.../route.ts(x)`,
// `app/.../page.ts(x)`, `app/.../layout.ts(x)`) without a config object —
// or with a config object that omits both `cache` and
// `next.revalidate`/`next.tags`. We can't reliably know "this is a
// Server Component" from the AST alone, so we approximate by:
//   1. Path contains `/app/` AND filename matches one of the App Router
//      file shapes (route|page|layout|template|loading|error|default
//      with .ts(x)? extension), AND
//   2. The file does not start with a `"use client"` directive, AND
//   3. The path does not pass through `node_modules/` or `dist/`
//      (vendored or built code).
const APP_ROUTER_FILE_PATTERN =
  /\/app\/(?:[^/]+\/)*(?:route|page|layout|template|loading|error|default)\.(?:tsx?|jsx?)$/;

const NON_PROJECT_PATH_PATTERN = /\/(?:node_modules|dist|build|\.next)\//;

export const serverFetchWithoutRevalidate = defineRule<Rule>({
  recommendation:
    'Pass `{ next: { revalidate: <seconds> } }` (or `cache: "no-store"` / `next: { tags: [...] }`) so stale cached data doesn\'t silently persist',
  create: (context: RuleContext) => {
    let isServerSideFile = false;

    return {
      Program(node: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        if (!APP_ROUTER_FILE_PATTERN.test(filename)) {
          isServerSideFile = false;
          return;
        }
        if (NON_PROJECT_PATH_PATTERN.test(filename)) {
          isServerSideFile = false;
          return;
        }
        const hasUseClient = (node.body ?? []).some(
          (statement: EsTreeNode) =>
            statement.type === "ExpressionStatement" &&
            statement.expression?.type === "Literal" &&
            statement.expression.value === "use client",
        );
        isServerSideFile = !hasUseClient;
      },
      CallExpression(node: EsTreeNode) {
        if (!isServerSideFile) return;
        if (!isFetchCall(node)) return;

        const optionsArg = node.arguments?.[1];
        if (optionsArg && objectExpressionHasNextRevalidate(optionsArg)) return;

        const urlArg = node.arguments?.[0];
        const urlText =
          urlArg?.type === "Literal" && typeof urlArg.value === "string"
            ? `"${urlArg.value}"`
            : "url";
        context.report({
          node,
          message: `fetch(${urlText}) in a Server Component / route handler defaults to forever-caching — pass { next: { revalidate: <seconds> } } / { next: { tags: [...] } } / { cache: "no-store" } so stale data doesn't quietly persist`,
        });
      },
    };
  },
});
