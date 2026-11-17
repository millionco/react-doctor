import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveJsxElementType } from "./resolve-jsx-element-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const LOGICAL_REL_EXISTING_CONTEXT_TARGETS = new Set(["_self", "_parent", "_top"]);

const isNativeHtmlAnchor = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  if (!isNodeOfType(opening.name, "JSXIdentifier") || opening.name.name !== "a") return false;
  let ancestor: EsTreeNode | null | undefined = opening.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "WithStatement")) return false;
    if (isNodeOfType(ancestor, "JSXElement")) {
      const name = resolveJsxElementType(ancestor.openingElement);
      if (name === "svg" || name === "math") return false;
    }
    ancestor = ancestor.parent;
  }
  return true;
};

export const isGuardedLogicalAnchorRel = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
  allowReferrer: boolean,
): boolean => {
  if (!isNativeHtmlAnchor(opening)) return false;
  let hasHref = false;
  let targetIndex = -1;
  let relIndex = -1;
  for (const [attributeIndex, attribute] of opening.attributes.entries()) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier")
    ) {
      return false;
    }
    const name = attribute.name.name;
    switch (name.toLowerCase()) {
      case "is":
      case "xlinkhref":
      case "xmlns":
        return false;
      case "href":
        if (name !== "href" || hasHref) return false;
        hasHref = true;
        break;
      case "target":
        if (name !== "target" || targetIndex >= 0) return false;
        targetIndex = attributeIndex;
        break;
      case "rel":
        if (name !== "rel" || relIndex >= 0) return false;
        relIndex = attributeIndex;
        break;
    }
  }
  if (!hasHref || targetIndex < 0 || relIndex < 0 || Math.abs(targetIndex - relIndex) !== 1) {
    return false;
  }

  const targetAttribute = opening.attributes[targetIndex];
  const relAttribute = opening.attributes[relIndex];
  if (
    !isNodeOfType(targetAttribute, "JSXAttribute") ||
    !isNodeOfType(relAttribute, "JSXAttribute") ||
    !isNodeOfType(targetAttribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(relAttribute.value, "JSXExpressionContainer")
  ) {
    return false;
  }
  const target = stripParenExpression(targetAttribute.value.expression);
  const rel = stripParenExpression(relAttribute.value.expression);
  if (
    !isNodeOfType(target, "ConditionalExpression") ||
    !isNodeOfType(rel, "LogicalExpression") ||
    rel.operator !== "&&"
  ) {
    return false;
  }
  const targetPredicate = stripParenExpression(target.test);
  const relPredicate = stripParenExpression(rel.left);
  if (!isNodeOfType(targetPredicate, "Identifier") || !isNodeOfType(relPredicate, "Identifier")) {
    return false;
  }
  const predicate = scopes.symbolFor(targetPredicate);
  if (
    !predicate ||
    (predicate.kind !== "const" && predicate.kind !== "parameter") ||
    predicate !== scopes.symbolFor(relPredicate) ||
    predicate.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }

  const truthyTarget = getStaticStringExpression(target.consequent);
  const falsyTarget = getStaticStringExpression(target.alternate);
  if (
    truthyTarget?.toLowerCase() !== "_blank" ||
    falsyTarget === null ||
    !LOGICAL_REL_EXISTING_CONTEXT_TARGETS.has(falsyTarget.toLowerCase())
  ) {
    return false;
  }
  const protection = getStaticStringExpression(rel.right);
  return (
    protection?.split(/[ \t\n\f\r]+/).some((token) => {
      const normalizedToken = token.toLowerCase();
      return normalizedToken === "noreferrer" || (allowReferrer && normalizedToken === "noopener");
    }) ?? false
  );
};
