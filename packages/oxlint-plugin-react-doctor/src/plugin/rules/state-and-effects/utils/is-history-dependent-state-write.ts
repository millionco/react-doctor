import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isComponentFunction } from "../../../utils/is-component-function.js";
import { isDirectNamedReactHookCall } from "../../../utils/is-direct-named-react-hook-call.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface HistoryReads {
  inputs: readonly SymbolDescriptor[];
  state: readonly EsTreeNode[];
}

const readTypedInput = (
  guard: EsTreeNode,
  expectedType: "number" | "string",
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const test = stripParenExpression(guard);
  if (
    !isNodeOfType(test, "BinaryExpression") ||
    test.operator !== "===" ||
    !isNodeOfType(test.right, "Literal") ||
    test.right.value !== expectedType ||
    !isNodeOfType(test.left, "UnaryExpression") ||
    test.left.operator !== "typeof" ||
    !isNodeOfType(test.left.argument, "Identifier")
  )
    return null;
  const input = scopes.symbolFor(test.left.argument);
  return input?.kind === "parameter" && input.scope.node === owner ? input : null;
};

const readOutputExpression = (statement: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) return null;
  const output = stripParenExpression(statement.argument);
  if (
    !isNodeOfType(output, "JSXElement") ||
    !isNodeOfType(output.openingElement.name, "JSXIdentifier") ||
    !/^[a-z][a-z0-9]*$/.test(output.openingElement.name.name) ||
    output.openingElement.attributes.length !== 0 ||
    output.children.length !== 1 ||
    !isNodeOfType(output.children[0], "JSXExpressionContainer")
  )
    return null;
  return stripParenExpression(output.children[0].expression);
};

const readPrimitivePeak = (
  selection: EsTreeNode,
  input: SymbolDescriptor,
  state: SymbolDescriptor,
  value: EsTreeNode,
  output: EsTreeNode,
  scopes: ScopeAnalysis,
): HistoryReads | null => {
  if (
    !isNodeOfType(selection, "BinaryExpression") ||
    selection.operator !== ">" ||
    !isNodeOfType(selection.left, "Identifier") ||
    scopes.symbolFor(selection.left) !== input ||
    !isNodeOfType(selection.right, "Identifier") ||
    scopes.symbolFor(selection.right) !== state ||
    !isNodeOfType(value, "Identifier") ||
    scopes.symbolFor(value) !== input ||
    !isNodeOfType(output, "Identifier") ||
    scopes.symbolFor(output) !== state
  )
    return null;
  return { inputs: [input], state: [selection.right, output] };
};

const readPlainRankedHistory = (
  selection: EsTreeNode,
  rank: SymbolDescriptor,
  message: SymbolDescriptor,
  state: SymbolDescriptor,
  value: EsTreeNode,
  output: EsTreeNode,
  scopes: ScopeAnalysis,
): HistoryReads | null => {
  if (!isNodeOfType(selection, "LogicalExpression") || selection.operator !== "||") return null;
  const empty = stripParenExpression(selection.left);
  const comparison = stripParenExpression(selection.right);
  if (
    !isNodeOfType(empty, "UnaryExpression") ||
    empty.operator !== "!" ||
    !isNodeOfType(empty.argument, "Identifier") ||
    scopes.symbolFor(empty.argument) !== state ||
    !isNodeOfType(comparison, "BinaryExpression") ||
    comparison.operator !== ">" ||
    !isNodeOfType(comparison.left, "Identifier") ||
    scopes.symbolFor(comparison.left) !== rank ||
    !isNodeOfType(comparison.right, "MemberExpression") ||
    comparison.right.computed ||
    comparison.right.optional ||
    !isNodeOfType(comparison.right.property, "Identifier") ||
    !isNodeOfType(comparison.right.object, "Identifier") ||
    scopes.symbolFor(comparison.right.object) !== state
  )
    return null;
  const shown = isNodeOfType(output, "ChainExpression") ? output.expression : output;
  if (
    !isNodeOfType(shown, "MemberExpression") ||
    shown.computed ||
    !shown.optional ||
    !isNodeOfType(shown.property, "Identifier") ||
    !isNodeOfType(shown.object, "Identifier") ||
    scopes.symbolFor(shown.object) !== state ||
    comparison.right.property.name === shown.property.name ||
    !isNodeOfType(value, "ObjectExpression") ||
    value.properties.length !== 2
  )
    return null;
  const expected = new Map([
    [comparison.right.property.name, rank],
    [shown.property.name, message],
  ]);
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name === "__proto__" ||
      !isNodeOfType(property.value, "Identifier") ||
      expected.get(property.key.name) !== scopes.symbolFor(property.value)
    )
      return null;
    expected.delete(property.key.name);
  }
  if (expected.size !== 0) return null;
  return {
    inputs: [rank, message],
    state: [empty.argument, comparison.right.object, shown.object],
  };
};

const keepsOnlyExpectedReads = (
  symbol: SymbolDescriptor,
  references: ReadonlySet<EsTreeNode>,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.length === references.size &&
  symbol.references.every(
    (reference) => reference.flag === "read" && references.has(reference.identifier),
  ) &&
  hasCompleteSymbolReferences(symbol, owner, scopes);

export const isHistoryDependentStateWrite = (
  effect: EsTreeNodeOfType<"CallExpression">,
  write: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isDirectNamedReactHookCall(effect, "useEffect", scopes) || effect.arguments.length !== 2)
    return false;
  const [callback, dependencies] = effect.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1 ||
    !isNodeOfType(dependencies, "ArrayExpression")
  )
    return false;
  const [branch] = callback.body.body;
  if (!isNodeOfType(branch, "IfStatement") || branch.alternate) return false;
  const setterStatement = isNodeOfType(branch.consequent, "BlockStatement")
    ? branch.consequent.body.length === 1 && branch.consequent.body[0]
    : branch.consequent;
  if (
    !setterStatement ||
    !isNodeOfType(setterStatement, "ExpressionStatement") ||
    setterStatement.expression !== write ||
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    !isNodeOfType(write.callee, "Identifier") ||
    write.arguments.length !== 1 ||
    !isNodeOfType(branch.test, "LogicalExpression") ||
    branch.test.operator !== "&&"
  )
    return false;

  const owner = findEnclosingFunction(effect);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    !isComponentFunction(owner) ||
    owner.params.length !== 1 ||
    !isNodeOfType(owner.params[0], "ObjectPattern") ||
    !owner.params[0].properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        isNodeOfType(property.key, "Identifier") &&
        isNodeOfType(property.value, "Identifier"),
    ) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.body.body.length !== 3
  )
    return false;
  const [stateDeclaration, effectStatement, render] = owner.body.body;
  if (
    !isNodeOfType(stateDeclaration, "VariableDeclaration") ||
    stateDeclaration.kind !== "const" ||
    stateDeclaration.declarations.length !== 1 ||
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    effectStatement.expression !== effect
  )
    return false;
  const tuple = resolveReactUseStatePair(write.callee, scopes);
  if (
    !tuple?.stateSymbol ||
    tuple.declarator !== stateDeclaration.declarations[0] ||
    tuple.setterSymbol !== scopes.symbolFor(write.callee) ||
    !isNodeOfType(tuple.declarator.id, "ArrayPattern") ||
    tuple.declarator.id.elements.length !== 2 ||
    !isNodeOfType(tuple.declarator.init, "CallExpression") ||
    !isDirectNamedReactHookCall(tuple.declarator.init, "useState", scopes) ||
    tuple.declarator.init.arguments.length !== 1 ||
    !keepsOnlyExpectedReads(tuple.setterSymbol, new Set([write.callee]), owner, scopes)
  )
    return false;
  const initial = tuple.declarator.init.arguments[0];
  const displayed = readOutputExpression(render);
  if (!displayed || !isNodeOfType(initial, "Literal")) return false;

  const guards = stripParenExpression(branch.test.left);
  const selection = stripParenExpression(branch.test.right);
  const value = stripParenExpression(write.arguments[0]);
  let reads: HistoryReads | null = null;
  if (typeof initial.value === "number" && Number.isFinite(initial.value)) {
    const input = readTypedInput(guards, "number", owner, scopes);
    if (input)
      reads = readPrimitivePeak(selection, input, tuple.stateSymbol, value, displayed, scopes);
  } else if (
    initial.value === null &&
    isNodeOfType(guards, "LogicalExpression") &&
    guards.operator === "&&"
  ) {
    const rank = readTypedInput(guards.left, "number", owner, scopes);
    const message = readTypedInput(guards.right, "string", owner, scopes);
    if (rank && message && rank !== message) {
      reads = readPlainRankedHistory(
        selection,
        rank,
        message,
        tuple.stateSymbol,
        value,
        displayed,
        scopes,
      );
    }
  }
  if (!reads || dependencies.elements.length !== reads.inputs.length + 1) return false;
  const dependencySymbols = new Set(
    dependencies.elements.map((dependency) =>
      isNodeOfType(dependency, "Identifier") ? scopes.symbolFor(dependency) : null,
    ),
  );
  const stateDependency = dependencies.elements.find(
    (dependency) =>
      isNodeOfType(dependency, "Identifier") && scopes.symbolFor(dependency) === tuple.stateSymbol,
  );
  return Boolean(
    stateDependency &&
    reads.inputs.every(
      (input) =>
        dependencySymbols.has(input) &&
        input.references.every((reference) => reference.flag === "read") &&
        hasCompleteSymbolReferences(input, owner, scopes),
    ) &&
    keepsOnlyExpectedReads(
      tuple.stateSymbol,
      new Set([...reads.state, stateDependency]),
      owner,
      scopes,
    ),
  );
};
