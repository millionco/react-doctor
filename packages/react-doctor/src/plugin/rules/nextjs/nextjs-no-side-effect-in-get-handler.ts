import { MUTATING_ROUTE_SEGMENTS, ROUTE_HANDLER_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSideEffect } from "../../utils/find-side-effect.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const extractMutatingRouteSegment = (filename: string): string | null => {
  const segments = filename.split("/");
  for (const segment of segments) {
    const cleaned = segment.replace(/^\[.*\]$/, "");
    if (MUTATING_ROUTE_SEGMENTS.has(cleaned)) return cleaned;
  }
  return null;
};

const getExportedGetHandlerBody = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "ExportNamedDeclaration")) return null;
  const declaration = node.declaration;
  if (!declaration) return null;

  if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id?.name === "GET") {
    return declaration.body;
  }

  if (isNodeOfType(declaration, "VariableDeclaration")) {
    for (const declarator of declaration.declarations ?? []) {
      if (
        isNodeOfType(declarator?.id, "Identifier") &&
        declarator.id.name === "GET" &&
        declarator.init &&
        (isNodeOfType(declarator.init, "ArrowFunctionExpression") ||
          isNodeOfType(declarator.init, "FunctionExpression"))
      ) {
        return declarator.init.body;
      }
    }
  }

  return null;
};

export const nextjsNoSideEffectInGetHandler = defineRule<Rule>({
  id: "nextjs-no-side-effect-in-get-handler",
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "error",
  category: "Security",
  recommendation:
    "Move the side effect to a POST handler and use a <form> or fetch with method POST — GET requests can be triggered by prefetching and are vulnerable to CSRF",
  examples: [
    {
      before:
        "export async function GET() {\n  await db.users.delete(...);\n  return Response.json({ ok: true });\n}",
      after:
        "export async function POST() {\n  await db.users.delete(...);\n  return Response.json({ ok: true });\n}",
    },
  ],
  create: (context: RuleContext) => ({
    ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
      const filename = context.getFilename?.() ?? "";
      if (!ROUTE_HANDLER_FILE_PATTERN.test(filename)) return;

      const handlerBody = getExportedGetHandlerBody(node);
      if (!handlerBody) return;

      const mutatingSegment = extractMutatingRouteSegment(filename);
      if (mutatingSegment) {
        context.report({
          node,
          message: `GET handler on "/${mutatingSegment}" route — use POST to prevent CSRF and unintended prefetch triggers`,
        });
        return;
      }

      const sideEffect = findSideEffect(handlerBody);
      if (sideEffect) {
        context.report({
          node,
          message: `GET handler has side effects (${sideEffect}) — use POST to prevent CSRF and unintended prefetch triggers`,
        });
      }
    },
  }),
});
