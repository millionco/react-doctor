import {
  APP_DIRECTORY_PATTERN,
  ROUTE_HANDLER_FILE_PATTERN,
  ROUTE_HANDLER_HTTP_METHODS,
} from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const programHasNamedHttpMethodExport = (programNode: EsTreeNodeOfType<"Program">): boolean => {
  for (const statement of programNode.body ?? []) {
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    const declaration = statement.declaration;
    if (
      isNodeOfType(declaration, "FunctionDeclaration") &&
      declaration.id?.name &&
      ROUTE_HANDLER_HTTP_METHODS.has(declaration.id.name)
    ) {
      return true;
    }
    if (isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations ?? []) {
        if (
          isNodeOfType(declarator.id, "Identifier") &&
          ROUTE_HANDLER_HTTP_METHODS.has(declarator.id.name)
        ) {
          return true;
        }
      }
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        isNodeOfType(specifier, "ExportSpecifier") &&
        isNodeOfType(specifier.exported, "Identifier") &&
        ROUTE_HANDLER_HTTP_METHODS.has(specifier.exported.name)
      ) {
        return true;
      }
    }
  }
  return false;
};

export const nextjsNoDefaultExportInRouteHandler = defineRule<Rule>({
  id: "nextjs-no-default-export-in-route-handler",
  title: "Default export in route handler",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Replace `export default` with named HTTP method exports: `export async function GET(request) { … }`",
  create: (context: RuleContext) => {
    let isAppRouteHandler = false;
    let programNode: EsTreeNodeOfType<"Program"> | null = null;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        const filename = normalizeFilename(context.filename ?? "");
        isAppRouteHandler =
          APP_DIRECTORY_PATTERN.test(filename) && ROUTE_HANDLER_FILE_PATTERN.test(filename);
        programNode = node;
      },
      ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
        if (!isAppRouteHandler || !programNode) return;
        if (programHasNamedHttpMethodExport(programNode)) return;

        context.report({
          node,
          message:
            "Default exports in route.ts are silently ignored. Next.js only recognizes named HTTP method exports (GET, POST, etc.).",
        });
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (!isAppRouteHandler || !programNode) return;

        const hasDefaultSpecifier = (node.specifiers ?? []).some(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") &&
            isNodeOfType(specifier.exported, "Identifier") &&
            specifier.exported.name === "default",
        );
        if (!hasDefaultSpecifier) return;
        if (programHasNamedHttpMethodExport(programNode)) return;

        context.report({
          node,
          message:
            "Default exports in route.ts are silently ignored. Next.js only recognizes named HTTP method exports (GET, POST, etc.).",
        });
      },
    };
  },
});
