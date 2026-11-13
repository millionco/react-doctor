import type { EsTreeNode } from "./es-tree-node.js";
import { findVisibleSymbol } from "./find-visible-symbol.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import type { RuleContext } from "./rule-context.js";

export const isJsxFactoryBound = (
  reference: EsTreeNode,
  factory: string,
  context: RuleContext,
): boolean => {
  const [rootName] = factory.split(".");
  if (!rootName) return false;
  return Boolean(
    findVisibleSymbol(reference, context.scopes, {
      name: rootName,
      accept: (symbol) => {
        if (symbol.kind === "import") return getValueImportDeclaration(symbol) !== null;
        if (
          symbol.kind === "ts-type-alias" ||
          symbol.kind === "ts-interface" ||
          symbol.kind === "ts-module"
        ) {
          return false;
        }
        if (
          symbol.declarationNode.type === "TSImportEqualsDeclaration" &&
          symbol.declarationNode.importKind === "type"
        ) {
          return false;
        }
        if (symbol.declarationNode.type === "TSEnumDeclaration" && symbol.declarationNode.const) {
          return false;
        }
        let declaration: EsTreeNode | null | undefined = symbol.declarationNode;
        while (declaration && declaration !== symbol.scope.node) {
          if ("declare" in declaration && declaration.declare) return false;
          declaration = declaration.parent;
        }
        return true;
      },
    }),
  );
};
