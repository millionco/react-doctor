import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookName } from "./is-react-hook-name.js";

export const getPlainClassHookFieldName = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isNodeOfType(functionNode, "ArrowFunctionExpression")) return null;
  const field = functionNode.parent;
  if (
    !field ||
    !isNodeOfType(field, "PropertyDefinition") ||
    field.value !== functionNode ||
    field.static ||
    field.computed ||
    field.accessibility === "private" ||
    field.accessibility === "protected" ||
    field.decorators?.length ||
    !isNodeOfType(field.key, "Identifier") ||
    field.key.name === "use" ||
    !isReactHookName(field.key.name)
  ) {
    return null;
  }
  const classBody = field.parent;
  const classNode = classBody?.parent;
  if (
    !classBody ||
    !isNodeOfType(classBody, "ClassBody") ||
    !classNode ||
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    classNode.superClass ||
    classNode.decorators?.length
  ) {
    return null;
  }
  const classIdentifiers = classNode.id ? [classNode.id] : [];
  const classExpressionRoot = findTransparentExpressionRoot(classNode);
  const declaration = classExpressionRoot.parent;
  if (
    isNodeOfType(classNode, "ClassExpression") &&
    declaration &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === classExpressionRoot &&
    isNodeOfType(declaration.id, "Identifier")
  ) {
    classIdentifiers.push(declaration.id);
  }
  if (classIdentifiers.length === 0) return null;
  if (
    classBody.body.some((member) => {
      const name = getStaticPropertyKeyName(member, { allowComputedString: true });
      return (
        name === "render" ||
        name === "isReactComponent" ||
        ((isNodeOfType(member, "MethodDefinition") || isNodeOfType(member, "PropertyDefinition")) &&
          member.computed &&
          name === null)
      );
    })
  ) {
    return null;
  }
  if (
    classIdentifiers.some((identifier) =>
      getEquivalentSymbols(identifier, scopes).some((symbol) =>
        symbol.references.some((reference) => {
          const classReference = findTransparentExpressionRoot(reference.identifier);
          const member = classReference.parent;
          if (
            !member ||
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== classReference
          ) {
            return false;
          }
          const name = getResolvedStaticPropertyName(member, scopes);
          return name === null || name === "prototype" || name === "isReactComponent";
        }),
      ),
    )
  ) {
    return null;
  }
  return field.key.name;
};
