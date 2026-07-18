import {
  INTERNAL_PAGE_PATH_PATTERN,
  METADATA_EXPORT_NAMES,
  PAGE_FILE_PATTERN,
} from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasAncestorMetadataLayout } from "../../utils/find-ancestor-metadata-layout.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

const unwrapAwaitedExpression = (node: EsTreeNode): EsTreeNode => {
  let expression = stripParenExpression(node);
  while (isNodeOfType(expression, "AwaitExpression")) {
    expression = stripParenExpression(expression.argument);
  }
  return expression;
};

const isNextNavigationRedirectCall = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = unwrapAwaitedExpression(node);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (context.scopes.symbolFor(callee)?.kind !== "import") return false;
  const importedName = getImportedNameFromModule(expression, callee.name, "next/navigation");
  return importedName === "redirect" || importedName === "permanentRedirect";
};

const isRedirectOnlyDefaultExport = (
  programNode: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): boolean => {
  const defaultExport = findExportedValue(programNode, "default");
  if (!defaultExport || !isFunctionLike(defaultExport)) return false;
  if (!isNodeOfType(defaultExport.body, "BlockStatement")) {
    return isNextNavigationRedirectCall(defaultExport.body, context);
  }
  if (defaultExport.body.body.length !== 1) return false;
  const onlyStatement = defaultExport.body.body[0];
  if (isNodeOfType(onlyStatement, "ExpressionStatement")) {
    return isNextNavigationRedirectCall(onlyStatement.expression, context);
  }
  if (isNodeOfType(onlyStatement, "ReturnStatement") && onlyStatement.argument) {
    return isNextNavigationRedirectCall(onlyStatement.argument, context);
  }
  return false;
};

export const nextjsMissingMetadata = defineRule({
  id: "nextjs-missing-metadata",
  title: "Page missing metadata for search previews",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Add metadata or `generateMetadata()` so search engines and social previews get a title and description.",
  create: (context: RuleContext) => ({
    Program(programNode: EsTreeNodeOfType<"Program">) {
      const filename = normalizeFilename(context.filename ?? "");
      if (!PAGE_FILE_PATTERN.test(filename)) return;
      if (INTERNAL_PAGE_PATH_PATTERN.test(filename)) return;
      // A "use client" page cannot export `metadata` / `generateMetadata`
      // (Next.js fails the build), so metadata for it can only live in a
      // layout — there is nothing to fix in this file.
      const hasUseClientDirective = (programNode.body ?? []).some(
        (statement) =>
          isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "Literal") &&
          statement.expression.value === "use client",
      );
      if (hasUseClientDirective) return;

      const hasMetadataExport = programNode.body?.some((statement) => {
        if (!isNodeOfType(statement, "ExportNamedDeclaration")) return false;
        const declaration = statement.declaration;
        if (isNodeOfType(declaration, "VariableDeclaration")) {
          return declaration.declarations?.some(
            (declarator) =>
              isNodeOfType(declarator.id, "Identifier") &&
              METADATA_EXPORT_NAMES.includes(declarator.id.name),
          );
        }
        if (isNodeOfType(declaration, "FunctionDeclaration")) {
          return declaration.id?.name === "generateMetadata";
        }
        // Specifier form: `export { metadata }`, `export { x as metadata }`,
        // or a re-export `export { metadata } from "./meta"`.
        return (statement.specifiers ?? []).some(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") &&
            isNodeOfType(specifier.exported, "Identifier") &&
            METADATA_EXPORT_NAMES.includes(specifier.exported.name),
        );
      });

      if (hasMetadataExport) return;
      if (isRedirectOnlyDefaultExport(programNode, context)) return;
      // A page inherits metadata merged down the segment chain, so skip the
      // directory walk only once the cheap in-file check comes up empty.
      if (hasAncestorMetadataLayout(context.filename ?? "")) return;

      context.report({
        node: programNode,
        message:
          "This page has no metadata, so search engines and social previews get no title or description.",
      });
    },
  }),
});
