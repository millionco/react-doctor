import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const closedProviderPrograms = new WeakMap<EsTreeNode, boolean>();

export const isClosedImportedSplideEventVector = (
  symbol: SymbolDescriptor,
  filename: string | undefined,
): boolean => {
  if (!filename) return false;
  const source = getValueImportSource(symbol);
  const exportedName = getImportedName(symbol.declarationNode);
  if (!source || !exportedName || (!source.startsWith("./") && !source.startsWith("../")))
    return false;
  const resolved = resolveCrossFileValueExportWithFilePath(filename, source, exportedName);
  if (
    !resolved ||
    resolveModulePath(filename, source) !== resolved.filePath ||
    !isNodeOfType(resolved.programNode, "Program")
  )
    return false;
  let providerClosed = closedProviderPrograms.get(resolved.programNode);
  if (providerClosed === undefined) {
    const isLiteralData = (node: EsTreeNode): boolean => {
      const pending = [node];
      while (pending.length > 0) {
        const candidate = pending.pop();
        if (!candidate) return false;
        const expression = stripParenExpression(candidate);
        if (isNodeOfType(expression, "Literal")) continue;
        if (!isNodeOfType(expression, "ArrayExpression")) return false;
        for (const element of expression.elements) {
          if (!element || isNodeOfType(element, "SpreadElement")) return false;
          pending.push(element);
        }
      }
      return true;
    };
    providerClosed = resolved.programNode.body.every((statement) => {
      if (isKeyedDraftTypeReference(statement) || isNodeOfType(statement, "EmptyStatement"))
        return true;
      if (isNodeOfType(statement, "ExpressionStatement"))
        return (
          isNodeOfType(statement.expression, "Literal") &&
          typeof statement.expression.value === "string"
        );
      if (isNodeOfType(statement, "ExportDefaultDeclaration"))
        return isLiteralData(statement.declaration);
      const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
        ? statement.declaration
        : statement;
      return Boolean(
        declaration &&
        isNodeOfType(declaration, "VariableDeclaration") &&
        declaration.kind === "const" &&
        declaration.declarations.every(
          (declarator) =>
            isNodeOfType(declarator.id, "Identifier") &&
            declarator.init &&
            isLiteralData(declarator.init),
        ),
      );
    });
    closedProviderPrograms.set(resolved.programNode, providerClosed);
  }
  if (!providerClosed) return false;
  const vector = stripParenExpression(resolved.exportedNode);
  return (
    isNodeOfType(vector, "ArrayExpression") &&
    vector.elements.every((element) => {
      if (!element || isNodeOfType(element, "SpreadElement")) return false;
      const value = stripParenExpression(element);
      if (isNodeOfType(value, "Literal")) return typeof value.value === "string";
      return (
        isNodeOfType(value, "ArrayExpression") &&
        value.elements.length === 2 &&
        value.elements.every((entry) =>
          Boolean(entry && isNodeOfType(entry, "Literal") && typeof entry.value === "string"),
        )
      );
    })
  );
};
