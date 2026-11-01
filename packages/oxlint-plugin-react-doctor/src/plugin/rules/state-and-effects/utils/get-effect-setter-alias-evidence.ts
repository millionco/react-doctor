import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import { collectConstAliasSymbols } from "../../../utils/collect-const-alias-symbols.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import {
  MAX_EFFECT_SETTER_ALIAS_COUNT,
  MAX_EFFECT_SETTER_ALIAS_REFERENCE_COUNT,
} from "./constants.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { hasUserInputSetterWriter } from "./has-user-input-setter-writer.js";

interface EffectSetterAliasEvidence {
  hasIndependentWriter: boolean;
  isComplete: boolean;
}

interface EffectSetterAliasEvidenceInput {
  analysis: ProgramAnalysis;
  context: RuleContext;
  stateDeclarator: EsTreeNode;
  invocation: EsTreeNodeOfType<"CallExpression">;
  effectFunction: EsTreeNode;
  writeFunction: EsTreeNode;
}

export const getEffectSetterAliasEvidence = ({
  analysis,
  context,
  stateDeclarator,
  invocation,
  effectFunction,
  writeFunction,
}: EffectSetterAliasEvidenceInput): EffectSetterAliasEvidence => {
  let hasIndependentWriter = false;
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator"))
    return { hasIndependentWriter, isComplete: false };
  if (!isNodeOfType(stateDeclarator.id, "ArrayPattern"))
    return { hasIndependentWriter, isComplete: false };
  const setterBinding = stateDeclarator.id.elements[1];
  if (!isNodeOfType(setterBinding, "Identifier"))
    return { hasIndependentWriter, isComplete: false };
  const setterSymbol = context.scopes.symbolFor(setterBinding);
  if (!setterSymbol) return { hasIndependentWriter, isComplete: false };
  const aliases = collectConstAliasSymbols(setterSymbol, context.scopes);
  if (aliases.length > MAX_EFFECT_SETTER_ALIAS_COUNT)
    return { hasIndependentWriter, isComplete: false };
  const referenceCount = aliases.reduce((count, alias) => count + alias.references.length, 0);
  if (
    referenceCount > MAX_EFFECT_SETTER_ALIAS_REFERENCE_COUNT ||
    aliases.some(
      (alias) =>
        alias.kind !== "const" ||
        alias.references.some(
          (reference) => reference.flag !== "read" || !getRef(analysis, reference.identifier),
        ),
    )
  ) {
    return { hasIndependentWriter, isComplete: false };
  }
  const aliasSymbolIds = new Set(aliases.map((alias) => alias.id));
  for (const alias of aliases) {
    const firstReference = alias.references[0];
    if (!firstReference) continue;
    const aliasReference = getRef(analysis, firstReference.identifier);
    if (!aliasReference) return { hasIndependentWriter, isComplete: false };
    hasIndependentWriter ||= hasUserInputSetterWriter(
      analysis,
      context,
      aliasReference,
      effectFunction,
      true,
    );
    for (const reference of alias.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      if (invocation.arguments.some((argument) => argument === referenceRoot)) continue;
      const parent = referenceRoot.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const aliasSymbol = context.scopes.symbolFor(parent.id);
        if (aliasSymbol && aliasSymbolIds.has(aliasSymbol.id)) continue;
      }
      if (
        isNodeOfType(parent, "CallExpression") &&
        parent.callee === referenceRoot &&
        (findEnclosingFunction(parent) === effectFunction ||
          findEnclosingFunction(parent) === writeFunction)
      ) {
        continue;
      }
      if (
        isNodeOfType(parent, "ArrayExpression") &&
        isNodeOfType(parent.parent, "CallExpression") &&
        parent.parent.arguments[1] === parent &&
        isReactHookCall(parent.parent, EFFECT_HOOK_NAMES, context.scopes)
      ) {
        continue;
      }
      return { hasIndependentWriter, isComplete: false };
    }
  }
  return { hasIndependentWriter, isComplete: true };
};
