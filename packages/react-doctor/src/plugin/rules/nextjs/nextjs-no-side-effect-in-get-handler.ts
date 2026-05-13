import { MUTATING_ROUTE_SEGMENTS, ROUTE_HANDLER_FILE_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSideEffect } from "../../utils/find-side-effect.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const extractMutatingRouteSegment = (filename: string): string | null => {
  const segments = filename.split("/");
  for (const segment of segments) {
    const cleaned = segment.replace(/^\[.*\]$/, "");
    if (MUTATING_ROUTE_SEGMENTS.has(cleaned)) return cleaned;
  }
  return null;
};

const getExportedGetHandlerBody = (node: EsTreeNode): EsTreeNode | null => {
  if (node.type !== "ExportNamedDeclaration") return null;
  const declaration = node.declaration;
  if (!declaration) return null;

  if (declaration.type === "FunctionDeclaration" && declaration.id?.name === "GET") {
    return declaration.body;
  }

  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations ?? []) {
      if (
        declarator?.id?.type === "Identifier" &&
        declarator.id.name === "GET" &&
        declarator.init &&
        (declarator.init.type === "ArrowFunctionExpression" ||
          declarator.init.type === "FunctionExpression")
      ) {
        return declarator.init.body;
      }
    }
  }

  return null;
};

export const nextjsNoSideEffectInGetHandler = defineRule<Rule>({
  recommendation:
    "Move the side effect to a POST handler and use a <form> or fetch with method POST — GET requests can be triggered by prefetching and are vulnerable to CSRF",
  create: (context: RuleContext) => ({
    ExportNamedDeclaration(node: EsTreeNode) {
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
