import type { StaticImport } from "oxc-parser";
import { resolveCrossFileFunctionExport } from "./resolve-cross-file-function-export.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { walkAst } from "./walk-ast.js";

export interface CollectImportedJsxComponentDependenciesInput {
  readonly absoluteFilePath: string;
  readonly staticImports: ReadonlyArray<StaticImport>;
  readonly program: EsTreeNode;
}

export const collectImportedJsxComponentDependencies = ({
  absoluteFilePath,
  staticImports,
  program,
}: CollectImportedJsxComponentDependenciesInput): void => {
  const jsxNames = new Set<string>();
  walkAst(program, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const nameNode = (node as { name?: EsTreeNode }).name;
    if (!nameNode) return;
    if (nameNode.type === "JSXIdentifier") {
      const name = (nameNode as { name?: unknown }).name;
      if (typeof name === "string") jsxNames.add(name);
    } else if (nameNode.type === "JSXMemberExpression") {
      const property = (nameNode as { property?: { type?: string; name?: unknown } }).property;
      if (property?.type === "JSXIdentifier" && typeof property.name === "string") {
        jsxNames.add(property.name);
      }
    } else if (nameNode.type === "JSXNamespacedName") {
      const namespace = (nameNode as { namespace?: { name?: unknown } }).namespace;
      if (typeof namespace?.name === "string") jsxNames.add(namespace.name);
    }
  });
  if (jsxNames.size === 0) return;

  for (const staticImport of staticImports) {
    for (const entry of staticImport.entries) {
      const { importName } = entry;
      if (importName.kind === "NamespaceObject") continue;
      if (!jsxNames.has(entry.localName.value)) continue;
      const exportedName = importName.kind === "Default" ? "default" : importName.name;
      if (exportedName) {
        resolveCrossFileFunctionExport(
          absoluteFilePath,
          staticImport.moduleRequest.value,
          exportedName,
        );
      }
    }
  }
};
