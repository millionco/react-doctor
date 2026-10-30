import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const hasClosedNativeReactComponentBase = (
  classNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(classNode, "ClassDeclaration") || !classNode.superClass) return false;
  const superclass = stripParenExpression(classNode.superClass);
  if (
    !isNodeOfType(superclass, "MemberExpression") ||
    superclass.computed ||
    superclass.optional ||
    getStaticPropertyName(superclass) !== "Component"
  )
    return false;
  const receiver = stripParenExpression(superclass.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const provider = scopes.symbolFor(receiver);
  if (
    !provider ||
    getValueImportSource(provider) !== "react" ||
    (!isNodeOfType(provider.declarationNode, "ImportNamespaceSpecifier") &&
      !isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier"))
  )
    return false;
  return provider.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const member = findTransparentExpressionRoot(reference.identifier).parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== findTransparentExpressionRoot(reference.identifier) ||
      member.computed ||
      member.optional
    )
      return false;
    const parent = findTransparentExpressionRoot(member).parent;
    if (getStaticPropertyName(member) === "Component")
      return (
        (isNodeOfType(parent, "ClassDeclaration") || isNodeOfType(parent, "ClassExpression")) &&
        parent.superClass === findTransparentExpressionRoot(member)
      );
    return (
      getStaticPropertyName(member) === "isValidElement" &&
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === findTransparentExpressionRoot(member) &&
      !parent.optional
    );
  });
};
