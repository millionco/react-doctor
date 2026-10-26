import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";

export interface OwnedInputState {
  readonly value: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly initial: EsTreeNode;
}

export const collectOwnedInputStates = (
  bindings: ReadonlyArray<UseStateBinding>,
  component: EsTreeNode,
  context: RuleContext,
): readonly OwnedInputState[] => {
  const program = findProgramRoot(component);
  if (!program) return [];
  const states: OwnedInputState[] = [];
  for (const binding of bindings) {
    const declarator = binding.declarator;
    if (
      findEnclosingFunction(declarator) !== component ||
      !isNodeOfType(declarator.parent, "VariableDeclaration") ||
      declarator.parent.kind !== "const" ||
      !isNodeOfType(declarator.id, "ArrayPattern") ||
      !isNodeOfType(declarator.init, "CallExpression") ||
      !isProvenUnmodifiedReactApiCall(declarator.init, "useState", context.scopes)
    )
      continue;
    const [valueNode, setterNode, ...remaining] = declarator.id.elements;
    if (
      remaining.length ||
      !isNodeOfType(valueNode, "Identifier") ||
      !isNodeOfType(setterNode, "Identifier")
    )
      continue;
    const pair = resolveReactUseStatePair(setterNode, context.scopes);
    const [initial, ...extraArguments] = declarator.init.arguments;
    if (
      !pair?.stateSymbol ||
      pair.declarator !== declarator ||
      !initial ||
      isNodeOfType(initial, "SpreadElement") ||
      extraArguments.length ||
      pair.stateSymbol.kind !== "const" ||
      pair.setterSymbol.kind !== "const"
    )
      continue;
    const stateReads = new Set(
      pair.stateSymbol.references.map((reference) => reference.identifier),
    );
    const setterCalls = new Set(
      pair.setterSymbol.references
        .filter((reference) => {
          const identifier = findTransparentExpressionRoot(reference.identifier);
          const call = identifier.parent;
          if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== identifier)
            return false;
          const [argument, ...extra] = call.arguments;
          return Boolean(argument && !isNodeOfType(argument, "SpreadElement") && !extra.length);
        })
        .map((reference) => reference.identifier),
    );
    if (
      !hasOnlyAllowedSymbolReads({
        symbol: pair.stateSymbol,
        allowedIdentifiers: stateReads,
        program,
        scopes: context.scopes,
      }) ||
      !hasOnlyAllowedSymbolReads({
        symbol: pair.setterSymbol,
        allowedIdentifiers: setterCalls,
        program,
        scopes: context.scopes,
      })
    )
      continue;
    states.push({ value: pair.stateSymbol, setter: pair.setterSymbol, initial });
  }
  return states;
};
