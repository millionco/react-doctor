import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { hasClosedReactHookProvider } from "../../../utils/has-closed-react-hook-provider.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { MIRROR_EFFECT_ARGUMENT_COUNT, MIRROR_STATE_ARGUMENT_COUNT } from "./constants.js";

interface ClosedRenamedMirrorOptions {
  initializer: EsTreeNode;
  setterIdentifier: EsTreeNodeOfType<"Identifier">;
  stateCall: EsTreeNodeOfType<"CallExpression">;
  setterCall: EsTreeNodeOfType<"CallExpression">;
  effectCall: EsTreeNodeOfType<"CallExpression">;
  callback: EsTreeNode;
  dependencies: EsTreeNodeOfType<"ArrayExpression">;
  isConstDeclaration: boolean;
  scopes: ScopeAnalysis;
}

export const isClosedRenamedMirror = (options: ClosedRenamedMirrorOptions): boolean => {
  const {
    initializer,
    setterIdentifier,
    stateCall,
    setterCall,
    effectCall,
    callback,
    dependencies,
    isConstDeclaration,
    scopes,
  } = options;
  if (
    !isConstDeclaration ||
    !isNodeOfType(initializer, "Identifier") ||
    !isNodeOfType(setterCall.callee, "Identifier") ||
    setterCall.optional ||
    stateCall.arguments.length !== MIRROR_STATE_ARGUMENT_COUNT ||
    setterCall.arguments.length !== MIRROR_STATE_ARGUMENT_COUNT ||
    effectCall.arguments.length !== MIRROR_EFFECT_ARGUMENT_COUNT ||
    effectCall.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
    !(
      isNodeOfType(callback, "ArrowFunctionExpression") ||
      (isNodeOfType(callback, "FunctionExpression") && !callback.id && !callback.generator)
    ) ||
    callback.async ||
    callback.params.length > 0
  )
    return false;
  const setterSymbol = scopes.symbolFor(setterIdentifier);
  const propSymbol = scopes.symbolFor(initializer);
  const argument = setterCall.arguments[0];
  if (
    !setterSymbol ||
    !propSymbol ||
    scopes.symbolFor(setterCall.callee) !== setterSymbol ||
    !isNodeOfType(argument, "Identifier") ||
    scopes.symbolFor(argument) !== propSymbol ||
    ![setterSymbol, propSymbol].every((symbol) =>
      symbol.references.every(
        (reference) =>
          isTypeScriptTypePosition(reference.identifier) ||
          (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
      ),
    )
  )
    return false;
  if (
    !dependencies.elements.every(
      (dependency) =>
        isNodeOfType(dependency, "Identifier") &&
        (scopes.symbolFor(dependency) === propSymbol ||
          scopes.symbolFor(dependency) === setterSymbol),
    )
  )
    return false;
  if (
    !setterSymbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const target = findTransparentExpressionRoot(reference.identifier);
      return (
        (isNodeOfType(target.parent, "CallExpression") &&
          target.parent.callee === target &&
          !target.parent.optional) ||
        dependencies.elements.some((dependency) => dependency === reference.identifier)
      );
    })
  )
    return false;
  return (
    hasClosedReactHookProvider(stateCall, "useState", scopes) &&
    hasClosedReactHookProvider(effectCall, EFFECT_HOOK_NAMES, scopes)
  );
};
