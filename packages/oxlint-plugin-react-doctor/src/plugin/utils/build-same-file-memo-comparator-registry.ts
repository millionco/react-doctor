import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface MemoComparatorDescriptor {
  readonly bindingIdentifier: EsTreeNode;
  readonly comparator: EsTreeNode;
}

const unwrapTopLevelDeclaration = (statement: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(statement, "ExportNamedDeclaration")) return statement.declaration;
  return statement;
};

export const buildSameFileMemoComparatorRegistry = (
  program: EsTreeNode,
): Map<string, MemoComparatorDescriptor> => {
  const registry = new Map<string, MemoComparatorDescriptor>();
  if (!isNodeOfType(program, "Program")) return registry;

  const memoBindings = new Set<string>();
  const reactNamespaceBindings = new Set<string>();
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration") || statement.source.value !== "react") {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        isNodeOfType(specifier, "ImportDefaultSpecifier") ||
        isNodeOfType(specifier, "ImportNamespaceSpecifier")
      ) {
        reactNamespaceBindings.add(specifier.local.name);
      } else if (
        isNodeOfType(specifier, "ImportSpecifier") &&
        getImportedName(specifier) === "memo"
      ) {
        memoBindings.add(specifier.local.name);
      }
    }
  }

  for (const statement of program.body) {
    const declaration = unwrapTopLevelDeclaration(statement);
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) continue;
    for (const declarator of declaration.declarations ?? []) {
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        !isNodeOfType(declarator.id, "Identifier") ||
        !declarator.init
      ) {
        continue;
      }
      const initializer = stripParenExpression(declarator.init);
      if (!isNodeOfType(initializer, "CallExpression")) continue;
      const callee = stripParenExpression(initializer.callee);
      const isNamedMemo = isNodeOfType(callee, "Identifier") && memoBindings.has(callee.name);
      const isNamespaceMemo =
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.object, "Identifier") &&
        reactNamespaceBindings.has(callee.object.name) &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "memo";
      if (!isNamedMemo && !isNamespaceMemo) continue;
      const comparator = initializer.arguments?.[1];
      if (!comparator || isNodeOfType(comparator, "SpreadElement")) continue;
      registry.set(declarator.id.name, {
        bindingIdentifier: declarator.id,
        comparator,
      });
    }
  }

  return registry;
};
