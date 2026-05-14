import { INTERNAL_PAGE_PATH_PATTERN, PAGE_FILE_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

export const nextjsMissingMetadata = defineRule<Rule>({
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "Add `export const metadata = { title: '...', description: '...' }` or `export async function generateMetadata()`",
  create: (context: RuleContext) => ({
    Program(programNode: EsTreeNode) {
      const filename = context.getFilename?.() ?? "";
      if (!PAGE_FILE_PATTERN.test(filename)) return;
      if (INTERNAL_PAGE_PATH_PATTERN.test(filename)) return;

      const hasMetadataExport = programNode.body?.some((statement: EsTreeNode) => {
        if (!isNodeOfType(statement, "ExportNamedDeclaration")) return false;
        const declaration = statement.declaration;
        if (isNodeOfType(declaration, "VariableDeclaration")) {
          return declaration.declarations?.some(
            (declarator: EsTreeNode) =>
              isNodeOfType(declarator.id, "Identifier") &&
              (declarator.id.name === "metadata" || declarator.id.name === "generateMetadata"),
          );
        }
        if (isNodeOfType(declaration, "FunctionDeclaration")) {
          return declaration.id?.name === "generateMetadata";
        }
        return false;
      });

      if (!hasMetadataExport) {
        context.report({
          node: programNode,
          message: "Page without metadata or generateMetadata export — hurts SEO",
        });
      }
    },
  }),
});
