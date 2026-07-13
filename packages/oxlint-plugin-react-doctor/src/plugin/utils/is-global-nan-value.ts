import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isGlobalNanValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const visitedSymbolIds = new Set<number>();

  const visit = (candidate: EsTreeNode): boolean => {
    const expression = stripParenExpression(candidate);
    if (isNodeOfType(expression, "Identifier")) {
      if (expression.name === "NaN" && scopes.isGlobalReference(expression)) return true;
      const symbol = scopes.symbolFor(expression);
      if (!symbol || symbol.kind !== "const" || visitedSymbolIds.has(symbol.id)) return false;
      visitedSymbolIds.add(symbol.id);
      const declaration = symbol.declarationNode;
      if (!isNodeOfType(declaration, "VariableDeclarator") || !declaration.init) return false;
      if (declaration.id === symbol.bindingIdentifier) return visit(declaration.init);
      const declarationInitializer = stripParenExpression(declaration.init);

      if (
        isNodeOfType(declaration.id, "ObjectPattern") &&
        isNodeOfType(declarationInitializer, "Identifier") &&
        declarationInitializer.name === "Number" &&
        scopes.isGlobalReference(declarationInitializer)
      ) {
        return declaration.id.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            property.value === symbol.bindingIdentifier &&
            getStaticPropertyKeyName(property, { allowComputedString: true }) === "NaN",
        );
      }

      if (
        isNodeOfType(declaration.id, "ArrayPattern") &&
        isNodeOfType(declarationInitializer, "ArrayExpression")
      ) {
        const bindingIndex = declaration.id.elements.findIndex(
          (element) => element === symbol.bindingIdentifier,
        );
        if (bindingIndex < 0) return false;
        const hasSpreadBeforeBinding = declarationInitializer.elements
          .slice(0, bindingIndex)
          .some(
            (initializerElement) =>
              initializerElement !== null && isNodeOfType(initializerElement, "SpreadElement"),
          );
        if (hasSpreadBeforeBinding) return false;
        const arrayValue = declarationInitializer.elements[bindingIndex];
        return Boolean(
          arrayValue && !isNodeOfType(arrayValue, "SpreadElement") && visit(arrayValue),
        );
      }
      return false;
    }

    if (!isNodeOfType(expression, "MemberExpression") || expression.computed) return false;
    const receiver = stripParenExpression(expression.object);
    return Boolean(
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "Number" &&
      scopes.isGlobalReference(receiver) &&
      isNodeOfType(expression.property, "Identifier") &&
      expression.property.name === "NaN",
    );
  };

  return visit(node);
};
