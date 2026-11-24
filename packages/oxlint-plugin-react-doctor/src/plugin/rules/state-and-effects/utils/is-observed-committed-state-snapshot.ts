import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isDirectNamedReactHookCall } from "../../../utils/is-direct-named-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../../utils/is-react-component-or-hook-name.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";

const readDirectEffectBody = (hook: EsTreeNodeOfType<"CallExpression">): EsTreeNode | undefined => {
  const callback = hook.arguments[0];
  if (
    hook.arguments.length !== 2 ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return undefined;
  }
  const statements = getCallbackStatements(callback);
  return statements.length === 1 ? statements[0] : undefined;
};

const matchesDirectEffectDependencies = (
  effect: EsTreeNodeOfType<"CallExpression">,
  expected: ReadonlyArray<SymbolDescriptor>,
  scopes: ScopeAnalysis,
): boolean => {
  const dependencies = effect.arguments[1];
  if (!isNodeOfType(dependencies, "ArrayExpression")) return false;
  if (dependencies.elements.length !== expected.length) return false;
  const dependencyBindings = new Set(
    dependencies.elements.map((element) =>
      isNodeOfType(element, "Identifier") ? scopes.symbolFor(element) : null,
    ),
  );
  return expected.every((binding) => dependencyBindings.has(binding));
};

const hasLayoutSnapshotReader = (
  layout: EsTreeNodeOfType<"CallExpression">,
  state: SymbolDescriptor,
  input: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const branch = readDirectEffectBody(layout);
  if (!isNodeOfType(branch, "IfStatement") || branch.alternate) return false;
  const comparison = branch.test;
  if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "!==") return false;
  const comparisonBindings = new Set([
    scopes.symbolFor(comparison.left),
    scopes.symbolFor(comparison.right),
  ]);
  if (!comparisonBindings.has(state) || !comparisonBindings.has(input)) return false;

  const consequence = branch.consequent;
  const statement = isNodeOfType(consequence, "BlockStatement")
    ? consequence.body.length === 1 && consequence.body[0]
    : consequence;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const reader = statement.expression;
  if (
    !isNodeOfType(reader, "CallExpression") ||
    reader.optional ||
    !isNodeOfType(reader.callee, "Identifier") ||
    reader.arguments.length !== 2 ||
    scopes.symbolFor(reader.arguments[0]) !== state ||
    scopes.symbolFor(reader.arguments[1]) !== input
  ) {
    return false;
  }
  const observer = scopes.symbolFor(reader.callee);
  return Boolean(
    observer &&
    observer !== input &&
    observer.kind === "parameter" &&
    observer.scope.node === owner &&
    observer.references.every((reference) => reference.flag === "read") &&
    matchesDirectEffectDependencies(layout, [state, input, observer], scopes) &&
    state.references.length === 3 &&
    state.references.every((reference) => reference.flag === "read") &&
    hasCompleteSymbolReferences(state, owner, scopes),
  );
};

const readCapturedInput = (
  callback: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null =>
  isNodeOfType(callback, "ArrowFunctionExpression") &&
  !callback.async &&
  callback.params.length === 0 &&
  isNodeOfType(callback.body, "Identifier")
    ? scopes.symbolFor(callback.body)
    : null;

const readsOnlyCurrentOutput = (
  result: EsTreeNode | null | undefined,
  input: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(result, "Literal")) return result.value === null;
  if (!isNodeOfType(result, "JSXElement")) return false;
  const tag = result.openingElement.name;
  return (
    isNodeOfType(tag, "JSXIdentifier") &&
    /^[a-z][a-z0-9]*$/.test(tag.name) &&
    result.openingElement.attributes.length === 0 &&
    result.children.every(
      (child) =>
        isNodeOfType(child, "JSXText") ||
        (isNodeOfType(child, "JSXExpressionContainer") &&
          isNodeOfType(child.expression, "Identifier") &&
          scopes.symbolFor(child.expression) === input),
    )
  );
};

export const isObservedCommittedStateSnapshot = (
  effect: EsTreeNodeOfType<"CallExpression">,
  write: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isDirectNamedReactHookCall(effect, "useEffect", scopes)) return false;
  const setup = readDirectEffectBody(effect);
  if (
    !isNodeOfType(setup, "ExpressionStatement") ||
    setup.expression !== write ||
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    write.arguments.length !== 1 ||
    !isNodeOfType(write.callee, "Identifier")
  ) {
    return false;
  }

  const owner = findEnclosingFunction(effect);
  if (
    !isNodeOfType(owner, "FunctionDeclaration") ||
    owner.async ||
    owner.generator ||
    !owner.id ||
    !isReactComponentOrHookName(owner.id.name) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.body.body.length !== 4
  ) {
    return false;
  }
  const [props] = owner.params;
  if (
    owner.params.length !== 1 ||
    !isNodeOfType(props, "ObjectPattern") ||
    props.properties.length !== 2 ||
    !props.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        isNodeOfType(property.key, "Identifier") &&
        isNodeOfType(property.value, "Identifier"),
    )
  ) {
    return false;
  }

  const [stateDeclaration, layoutStatement, passiveStatement, output] = owner.body.body;
  if (
    !isNodeOfType(stateDeclaration, "VariableDeclaration") ||
    stateDeclaration.kind !== "const" ||
    stateDeclaration.declarations.length !== 1 ||
    !isNodeOfType(layoutStatement, "ExpressionStatement") ||
    !isNodeOfType(layoutStatement.expression, "CallExpression") ||
    !isDirectNamedReactHookCall(layoutStatement.expression, "useLayoutEffect", scopes) ||
    !isNodeOfType(passiveStatement, "ExpressionStatement") ||
    passiveStatement.expression !== effect ||
    !isNodeOfType(output, "ReturnStatement")
  ) {
    return false;
  }
  const pair = resolveReactUseStatePair(write.callee, scopes);
  const input = readCapturedInput(write.arguments[0], scopes);
  const hook = pair?.declarator.init;
  return Boolean(
    pair?.stateSymbol &&
    pair.declarator === stateDeclaration.declarations[0] &&
    isNodeOfType(pair.declarator.id, "ArrayPattern") &&
    pair.declarator.id.elements.length === 2 &&
    pair.setterSymbol === scopes.symbolFor(write.callee) &&
    pair.setterSymbol.references.length === 1 &&
    hasCompleteSymbolReferences(pair.setterSymbol, owner, scopes) &&
    isNodeOfType(hook, "CallExpression") &&
    isDirectNamedReactHookCall(hook, "useState", scopes) &&
    hook.arguments.length === 1 &&
    input &&
    input.kind === "parameter" &&
    input.scope.node === owner &&
    readsOnlyCurrentOutput(output.argument, input, scopes) &&
    input === readCapturedInput(hook.arguments[0], scopes) &&
    matchesDirectEffectDependencies(effect, [input], scopes) &&
    input.references.every((reference) => reference.flag === "read") &&
    hasLayoutSnapshotReader(layoutStatement.expression, pair.stateSymbol, input, owner, scopes),
  );
};
