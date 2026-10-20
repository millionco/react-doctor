import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getRangeStart } from "../../../utils/get-range-start.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";

interface EffectLocalPayloadSourceOptions {
  payloadSymbol: SymbolDescriptor;
  effectCallback:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">;
  context: RuleContext;
}

export const getEffectLocalPayloadSourceSymbol = ({
  payloadSymbol,
  effectCallback,
  context,
}: EffectLocalPayloadSourceOptions): SymbolDescriptor | null => {
  const initializer = getDirectConstInitializer(payloadSymbol);
  const declaration = payloadSymbol.declarationNode.parent;
  if (
    !isNodeOfType(initializer, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.parent !== effectCallback.body ||
    !isNodeReachableWithinFunction(declaration, context, {
      evaluatePrimitiveLiteralTruthiness: true,
    })
  )
    return null;
  const [, declarationEnd] = declaration.range ?? [];
  if (
    typeof declarationEnd !== "number" ||
    payloadSymbol.references.some((reference) => {
      const referenceStart = getRangeStart(reference.identifier);
      return (
        reference.flag !== "read" ||
        isBindingAssignmentTarget(reference.identifier) ||
        context.cfg.enclosingFunction(reference.identifier) !== effectCallback ||
        referenceStart === null ||
        referenceStart < declarationEnd
      );
    })
  )
    return null;
  return context.scopes.symbolFor(initializer);
};
