import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getSymbolTypeAnnotation } from "../../utils/get-symbol-type-annotation.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isDirectNamedReactHookCall } from "../../utils/is-direct-named-react-hook-call.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { unwrapExpression } from "./exhaustive-deps-low-level.js";

const readDirectBinding = (node: EsTreeNode | null | undefined, scopes: ScopeAnalysis) => {
  if (!node) return null;
  const value = unwrapExpression(node);
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = scopes.symbolFor(value);
  return symbol && isSymbolReadOnly(symbol) ? symbol : null;
};

const readStatePair = (state: SymbolDescriptor, scopes: ScopeAnalysis) => {
  const declaration = state.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isDirectNamedReactHookCall(declaration.init, "useState", scopes)
  ) {
    return null;
  }
  const pair =
    declaration.id.elements[1] && resolveReactUseStatePair(declaration.id.elements[1], scopes);
  return pair?.stateSymbol === state
    ? { ...pair, statement: declaration.parent, call: declaration.init }
    : null;
};

const readFirstGuardedSetter = (
  setter: SymbolDescriptor,
  input: SymbolDescriptor,
  guard: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"IfStatement"> | null => {
  if (
    setter.references.length !== 1 ||
    !hasCompleteSymbolReferences(setter, scopes.rootScope.node, scopes)
  )
    return null;
  const [reference] = setter.references;
  const call = reference.identifier.parent;
  const statement = call?.parent;
  const block = statement?.parent;
  const branch = block?.parent;
  if (
    reference.flag !== "read" ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== reference.identifier ||
    call.optional ||
    call.arguments.length !== 1 ||
    readDirectBinding(call.arguments[0], scopes) !== input ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    block.body[0] !== statement ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.consequent !== block ||
    branch.alternate ||
    readDirectBinding(branch.test, scopes) !== guard
  ) {
    return null;
  }
  return branch;
};

export const isRenderRetryStateFallback = (
  derived: SymbolDescriptor,
  memo: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const selection = getDirectConstInitializer(derived);
  const derivedStatement = derived.declarationNode.parent;
  const owner = derivedStatement?.parent;
  const memoDeclarator = memo.parent;
  const memoStatement = memoDeclarator?.parent;
  if (
    !isNodeOfType(selection, "ConditionalExpression") ||
    !isSymbolReadOnly(derived) ||
    !isNodeOfType(selection.consequent, "ArrayExpression") ||
    selection.consequent.elements.length !== 0 ||
    !isNodeOfType(derivedStatement, "VariableDeclaration") ||
    !isNodeOfType(owner, "BlockStatement") ||
    !isFunctionLike(owner.parent) ||
    owner.parent.body !== owner ||
    !isNodeOfType(memoDeclarator, "VariableDeclarator") ||
    memoDeclarator.init !== memo ||
    !isNodeOfType(memoStatement, "VariableDeclaration") ||
    memoStatement.parent !== owner ||
    !isDirectNamedReactHookCall(memo, "useMemo", scopes)
  ) {
    return false;
  }

  const guard = readDirectBinding(selection.test, scopes);
  const comparison = guard && getDirectConstInitializer(guard);
  const selectedState = readDirectBinding(selection.alternate, scopes);
  const selectedPair = selectedState && readStatePair(selectedState, scopes);
  if (
    !guard ||
    !selectedPair ||
    !isNodeOfType(comparison, "BinaryExpression") ||
    comparison.operator !== "!=="
  ) {
    return false;
  }
  const operands = [
    readDirectBinding(comparison.left, scopes),
    readDirectBinding(comparison.right, scopes),
  ];
  const input = operands.find((operand) => operand?.kind === "parameter");
  const previous = operands.find((operand) => operand && operand !== input);
  if (
    !input ||
    !previous ||
    input.scope.node !== owner.parent ||
    !isNodeOfType(getSymbolTypeAnnotation(input), "TSStringKeyword") ||
    !hasCompleteSymbolReferences(input, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  const previousPair = readStatePair(previous, scopes);
  if (
    !previousPair ||
    previous === selectedState ||
    previousPair.call.arguments.length !== 1 ||
    readDirectBinding(previousPair.call.arguments[0], scopes) !== input
  ) {
    return false;
  }
  const reset = readFirstGuardedSetter(previousPair.setterSymbol, input, guard, scopes);
  const guardStatement = guard.declarationNode.parent;
  const guardIndex = owner.body.findIndex((statement) => statement === guardStatement);
  const resetIndex = owner.body.findIndex((statement) => statement === reset);
  const derivedIndex = owner.body.findIndex((statement) => statement === derivedStatement);
  const memoIndex = owner.body.findIndex((statement) => statement === memoStatement);
  const previousIndex = owner.body.findIndex((statement) => statement === previousPair.statement);
  const selectedIndex = owner.body.findIndex((statement) => statement === selectedPair.statement);
  return (
    previousIndex >= 0 &&
    selectedIndex >= 0 &&
    previousIndex < guardIndex &&
    selectedIndex < guardIndex &&
    guardIndex < resetIndex &&
    resetIndex < derivedIndex &&
    derivedIndex < memoIndex
  );
};
