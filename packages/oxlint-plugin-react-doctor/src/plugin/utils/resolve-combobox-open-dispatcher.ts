import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getLocalComboboxCallback } from "./get-local-combobox-callback.js";
import type { LocalComboboxCallback } from "./get-local-combobox-callback.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface ComboboxOpenDispatcher {
  readonly callback: LocalComboboxCallback;
  readonly phase: SymbolDescriptor;
  readonly controlled: SymbolDescriptor;
  readonly localState: SymbolDescriptor;
  readonly localSetter: SymbolDescriptor;
  readonly changed: SymbolDescriptor;
}

export const resolveComboboxOpenDispatcher = (
  callee: EsTreeNode,
  phaseExpression: EsTreeNode,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): ComboboxOpenDispatcher | null => {
  const callback = getLocalComboboxCallback(callee, scopes);
  const phaseIdentifier = stripParenExpression(phaseExpression);
  const phase = isNodeOfType(phaseIdentifier, "Identifier")
    ? scopes.symbolFor(phaseIdentifier)
    : null;
  if (
    !callback ||
    callback.node.params.length !== 1 ||
    callback.statements.length !== 2 ||
    findEnclosingFunction(callback.node) !== owner ||
    phase?.kind !== "const" ||
    !phase.initializer ||
    hasSymbolBindingWrites(phase)
  )
    return null;
  const parameter = callback.node.params[0];
  if (!isNodeOfType(parameter, "Identifier")) return null;
  const parameterSymbol = scopes.symbolFor(parameter);
  const selection = stripParenExpression(phase.initializer);
  if (!parameterSymbol || !isNodeOfType(selection, "ConditionalExpression")) return null;
  const condition = stripParenExpression(selection.test);
  if (
    !isNodeOfType(condition, "BinaryExpression") ||
    condition.operator !== "!==" ||
    !isNodeOfType(stripParenExpression(condition.left), "Identifier") ||
    !isNodeOfType(stripParenExpression(condition.right), "Identifier") ||
    !scopes.isGlobalReference(stripParenExpression(condition.right))
  )
    return null;
  const undefinedIdentifier = stripParenExpression(condition.right);
  if (!isNodeOfType(undefinedIdentifier, "Identifier") || undefinedIdentifier.name !== "undefined")
    return null;
  const controlled = scopes.symbolFor(stripParenExpression(condition.left));
  const consequent = stripParenExpression(selection.consequent);
  if (
    !controlled ||
    controlled.kind !== "parameter" ||
    hasSymbolBindingWrites(controlled) ||
    findEnclosingFunction(controlled.bindingIdentifier) !== owner ||
    findEnclosingFunction(phase.declarationNode) !== owner ||
    !isNodeOfType(consequent, "Identifier") ||
    scopes.symbolFor(consequent) !== controlled
  )
    return null;
  const alternate = stripParenExpression(selection.alternate);
  const update = callback.statements[0];
  if (!isNodeOfType(update, "IfStatement") || update.alternate) return null;
  const guard = stripParenExpression(update.test);
  if (
    !isNodeOfType(guard, "BinaryExpression") ||
    guard.operator !== "===" ||
    !isNodeOfType(stripParenExpression(guard.left), "Identifier") ||
    scopes.symbolFor(stripParenExpression(guard.left)) !== controlled ||
    !isNodeOfType(stripParenExpression(guard.right), "Identifier")
  )
    return null;
  const absent = stripParenExpression(guard.right);
  if (
    !isNodeOfType(absent, "Identifier") ||
    absent.name !== "undefined" ||
    !scopes.isGlobalReference(absent)
  )
    return null;
  const writeStatement =
    isNodeOfType(update.consequent, "BlockStatement") && update.consequent.body.length === 1
      ? update.consequent.body[0]
      : update.consequent;
  if (!isNodeOfType(writeStatement, "ExpressionStatement")) return null;
  const write = stripParenExpression(writeStatement.expression);
  if (!isNodeOfType(write, "CallExpression") || write.optional || write.arguments.length !== 1)
    return null;
  const pair = resolveReactUseStatePair(write.callee, scopes);
  if (
    !pair?.stateSymbol ||
    pair.stateSymbol.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    hasSymbolBindingWrites(pair.stateSymbol) ||
    hasSymbolBindingWrites(pair.setterSymbol) ||
    !pair.declarator.init ||
    !isProvenUnmodifiedReactApiCall(pair.declarator.init, "useState", scopes) ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    pair.declarator.init.arguments.length !== 1 ||
    !pair.declarator.init.arguments[0] ||
    !isNodeOfType(alternate, "Identifier") ||
    scopes.symbolFor(alternate) !== pair.stateSymbol
  )
    return null;
  const initialState = stripParenExpression(pair.declarator.init.arguments[0]);
  if (!isNodeOfType(initialState, "Literal") || initialState.value !== false) return null;
  const argument = write.arguments[0];
  if (!isNodeOfType(argument, "Identifier") || scopes.symbolFor(argument) !== parameterSymbol)
    return null;
  const notifyStatement = callback.statements[1];
  if (!isNodeOfType(notifyStatement, "ExpressionStatement")) return null;
  const outer = stripParenExpression(notifyStatement.expression);
  const notify = isNodeOfType(outer, "ChainExpression") ? outer.expression : outer;
  if (
    !isNodeOfType(notify, "CallExpression") ||
    !notify.optional ||
    !isNodeOfType(notify.callee, "Identifier") ||
    notify.arguments.length !== 1 ||
    !isNodeOfType(notify.arguments[0], "Identifier") ||
    scopes.symbolFor(notify.arguments[0]) !== parameterSymbol
  )
    return null;
  const changed = scopes.symbolFor(notify.callee);
  if (
    !changed ||
    changed.kind !== "parameter" ||
    hasSymbolBindingWrites(changed) ||
    findEnclosingFunction(changed.bindingIdentifier) !== owner
  )
    return null;
  const allowed = new Set<EsTreeNode>([argument, notify.arguments[0]]);
  if (
    !hasOnlyAllowedSymbolReads({
      symbol: parameterSymbol,
      allowedIdentifiers: allowed,
      program: scopes.rootScope.node,
      scopes,
    })
  )
    return null;
  if (
    !hasOnlyAllowedSymbolReads({
      symbol: pair.setterSymbol,
      allowedIdentifiers: new Set([write.callee]),
      program: scopes.rootScope.node,
      scopes,
    })
  )
    return null;
  if (callback.wrapper) {
    const dependencyArray = callback.wrapper.arguments[1];
    if (!isNodeOfType(dependencyArray, "ArrayExpression")) return null;
    const dependencies = dependencyArray.elements.map((element) =>
      element && isNodeOfType(element, "Identifier") ? scopes.symbolFor(element) : null,
    );
    if (
      dependencies.length !== 2 ||
      !dependencies.includes(controlled) ||
      !dependencies.includes(changed)
    )
      return null;
  }
  return {
    callback,
    phase,
    controlled,
    localState: pair.stateSymbol,
    localSetter: pair.setterSymbol,
    changed,
  };
};
