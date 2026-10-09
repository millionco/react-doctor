import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getStaticObjectPropertyValue } from "./get-static-object-property-value.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { serializeReferenceKey } from "./serialize-reference-key.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const collectRenderPropChangeKeys = (
  test: EsTreeNode,
  branch: EsTreeNode,
  scopes: ScopeAnalysis,
): string[] => {
  const comparison = stripParenExpression(test);
  if (isNodeOfType(comparison, "LogicalExpression") && comparison.operator === "||") {
    const left = collectRenderPropChangeKeys(comparison.left, branch, scopes);
    const right = collectRenderPropChangeKeys(comparison.right, branch, scopes);
    return left.length && right.length ? [...left, ...right] : [];
  }
  if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "!==") return [];
  for (const [current, previous] of [
    [comparison.left, comparison.right],
    [comparison.right, comparison.left],
  ]) {
    if (!isNodeOfType(current, "Identifier")) continue;
    const prop = resolveConstIdentifierAlias(current, scopes);
    if (
      prop?.kind !== "parameter" ||
      prop.references.some((reference) => reference.flag !== "read")
    )
      continue;
    const previousRoot = isNodeOfType(previous, "MemberExpression") ? previous.object : previous;
    const state = scopes.symbolFor(previousRoot);
    if (!state || state.references.some((reference) => reference.flag !== "read")) continue;
    const declarator = state.declarationNode;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "ArrayPattern")
    )
      continue;
    const setter = declarator.id.elements[1];
    if (!setter) continue;
    const pair = resolveReactUseStatePair(setter, scopes);
    if (
      pair?.stateSymbol?.id !== state.id ||
      !isNodeOfType(pair?.declarator.init, "CallExpression")
    )
      continue;
    const property = isNodeOfType(previous, "MemberExpression")
      ? getStaticPropertyName(previous)
      : null;
    if (isNodeOfType(previous, "MemberExpression") && !property) continue;
    if (
      property &&
      !state.references.every((reference) => {
        const member = reference.identifier.parent;
        const comparison = member?.parent;
        return (
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference.identifier &&
          isNodeOfType(comparison, "BinaryExpression") &&
          ["===", "!=="].includes(comparison.operator)
        );
      })
    )
      continue;
    const selectsProp = (value: EsTreeNode | null | undefined): boolean => {
      const selected = value && property ? getStaticObjectPropertyValue(value, property) : value;
      return Boolean(selected && resolveConstIdentifierAlias(selected, scopes)?.id === prop.id);
    };
    if (!selectsProp(pair.declarator.init.arguments[0])) continue;
    const updates = pair.setterSymbol.references;
    if (
      !updates.length ||
      !updates.every((reference) => {
        const call = reference.identifier.parent;
        return (
          reference.flag === "read" &&
          isNodeOfType(call, "CallExpression") &&
          call.callee === reference.identifier &&
          findEnclosingFunction(call) === findEnclosingFunction(branch) &&
          isNodeOnUnconditionalPath(call, branch) &&
          selectsProp(call.arguments[0])
        );
      })
    )
      continue;
    const key = serializeReferenceKey({ node: prop.bindingIdentifier, scopes });
    if (key) return [key];
  }
  return [];
};
