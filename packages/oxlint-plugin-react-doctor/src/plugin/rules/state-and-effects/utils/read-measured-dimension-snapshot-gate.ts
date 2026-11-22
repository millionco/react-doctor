import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export interface MeasuredDimensionSnapshotGate {
  readonly effectCallback: EsTreeNodeOfType<"ArrowFunctionExpression">;
  readonly owner: EsTreeNode;
  readonly snapshotSymbol: SymbolDescriptor;
  readonly dimensions: ReadonlyArray<{
    readonly key: "width" | "height";
    readonly stateSymbol: SymbolDescriptor;
    readonly setterSymbol: SymbolDescriptor;
  }>;
  readonly recaptureStatement: EsTreeNodeOfType<"ExpressionStatement">;
}

const namedReactCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(node.callee);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  const api = resolveImportedApiReference(node.callee, scopes);
  return Boolean(
    symbol?.kind === "import" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    api?.source === "react" &&
    api.importedName === name,
  );
};
const literal = (node: EsTreeNode | null | undefined, value: number): boolean =>
  Boolean(
    node &&
    isNodeOfType(stripParenExpression(node), "Literal") &&
    (stripParenExpression(node) as EsTreeNodeOfType<"Literal">).value === value,
  );
const directMember = (
  node: EsTreeNode,
  key: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === key;
const closed = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  symbol.references.every((reference) => reference.flag === "read");
const directReturn = (node: EsTreeNode): boolean => {
  const exit = isNodeOfType(node, "BlockStatement") && node.body.length === 1 ? node.body[0] : node;
  return isNodeOfType(exit, "ReturnStatement") && !exit.argument;
};
const zeroRecord = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ObjectExpression") || node.properties.length !== 2) return false;
  return ["width", "height"].every((key) =>
    node.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        !property.method &&
        property.kind === "init" &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === key &&
        literal(property.value, 0),
    ),
  );
};

/** Returns gate evidence ONLY. Callers must independently prove every dimension
 * writer is numeric native geometry; this result never authorizes suppression. */
export const readMeasuredDimensionSnapshotGate = (
  callback: EsTreeNode,
  writeNode: EsTreeNode,
  scopes: ScopeAnalysis,
): MeasuredDimensionSnapshotGate | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !isNodeOfType(writeNode, "CallExpression") ||
    findEnclosingFunction(writeNode) !== callback
  )
    return null;
  const effect = callback.parent;
  const statement = effect?.parent;
  const owner = effect ? findEnclosingFunction(effect) : null;
  const ownerBody = owner && isFunctionLike(owner) ? owner.body : null;
  if (
    !effect ||
    !namedReactCall(effect, "useEffect", scopes) ||
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== callback ||
    effect.arguments.length !== 2 ||
    !isNodeOfType(effect.arguments[1], "ArrayExpression") ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(ownerBody, "BlockStatement") ||
    statement.parent !== ownerBody ||
    someAst(
      scopes.rootScope.node,
      (node) =>
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && node.name === "eval"),
    )
  )
    return null;

  const body = callback.body.body;
  const index = isNodeOfType(body[0], "IfStatement") ? 1 : 0;
  const declaration = body[index];
  const guard = body[index + 1];
  const recapture = body[index + 2];
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !directReturn(guard.consequent) ||
    !isNodeOfType(recapture, "ExpressionStatement")
  )
    return null;
  const change = declaration.declarations[0];
  const test = stripParenExpression(guard.test);
  if (
    !isNodeOfType(change.id, "Identifier") ||
    !change.init ||
    !isNodeOfType(test, "UnaryExpression") ||
    test.operator !== "!" ||
    !isNodeOfType(test.argument, "Identifier")
  )
    return null;
  const changed = scopes.symbolFor(change.id);
  if (
    !changed ||
    scopes.symbolFor(test.argument) !== changed ||
    !closed(changed, scopes) ||
    changed.references.length !== 1 ||
    changed.references[0].identifier !== test.argument
  )
    return null;
  const pair = stripParenExpression(change.init);
  if (!isNodeOfType(pair, "LogicalExpression") || pair.operator !== "||") return null;
  const dimensions: Array<{
    key: "width" | "height";
    stateSymbol: SymbolDescriptor;
    setterSymbol: SymbolDescriptor;
  }> = [];
  const snapshotReads: EsTreeNode[] = [];
  let snapshot: SymbolDescriptor | null = null;
  for (const [rawComparison, key] of [
    [pair.left, "width"],
    [pair.right, "height"],
  ] as const) {
    const comparison = stripParenExpression(rawComparison);
    if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "!==") return null;
    const left = stripParenExpression(comparison.left);
    const right = stripParenExpression(comparison.right);
    if (
      !directMember(left, key) ||
      !directMember(left.object, "current") ||
      !isNodeOfType(left.object.object, "Identifier") ||
      !isNodeOfType(right, "Identifier")
    )
      return null;
    const record = scopes.symbolFor(left.object.object);
    const state = scopes.symbolFor(right);
    if (!record || (snapshot && snapshot !== record) || !state || !closed(state, scopes))
      return null;
    snapshot = record;
    snapshotReads.push(left.object.object);
    const declarator = state.declarationNode;
    const stateDeclaration = declarator.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "ArrayPattern") ||
      declarator.id.elements.length !== 2 ||
      declarator.id.elements[0] !== state.bindingIdentifier ||
      !isNodeOfType(stateDeclaration, "VariableDeclaration") ||
      stateDeclaration.kind !== "const" ||
      stateDeclaration.parent !== ownerBody ||
      !declarator.init ||
      !namedReactCall(declarator.init, "useState", scopes) ||
      !isNodeOfType(declarator.init, "CallExpression") ||
      declarator.init.arguments.length !== 1 ||
      !literal(declarator.init.arguments[0], 0) ||
      !isNodeOfType(declarator.id.elements[1], "Identifier")
    )
      return null;
    const setter = scopes.symbolFor(declarator.id.elements[1]);
    if (!setter || getNodeStartIndex(stateDeclaration) >= getNodeStartIndex(statement)) return null;
    dimensions.push({ key, stateSymbol: state, setterSymbol: setter });
  }
  if (
    !snapshot ||
    !closed(snapshot, scopes) ||
    dimensions[0].stateSymbol === dimensions[1].stateSymbol
  )
    return null;
  const snapshotDeclaration = snapshot.declarationNode;
  const container = snapshotDeclaration.parent;
  if (
    !isNodeOfType(snapshotDeclaration, "VariableDeclarator") ||
    snapshotDeclaration.id !== snapshot.bindingIdentifier ||
    !isNodeOfType(container, "VariableDeclaration") ||
    container.kind !== "const" ||
    container.parent !== ownerBody ||
    !snapshotDeclaration.init ||
    !namedReactCall(snapshotDeclaration.init, "useRef", scopes) ||
    !isNodeOfType(snapshotDeclaration.init, "CallExpression") ||
    snapshotDeclaration.init.arguments.length !== 1 ||
    !zeroRecord(snapshotDeclaration.init.arguments[0]) ||
    getNodeStartIndex(container) >= getNodeStartIndex(statement)
  )
    return null;
  const assignment = stripParenExpression(recapture.expression);
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !directMember(assignment.left, "current") ||
    !isNodeOfType(assignment.left.object, "Identifier") ||
    scopes.symbolFor(assignment.left.object) !== snapshot ||
    !isNodeOfType(assignment.right, "ObjectExpression") ||
    assignment.right.properties.length !== 2
  )
    return null;
  for (const { key, stateSymbol } of dimensions) {
    if (
      !assignment.right.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          !property.method &&
          property.kind === "init" &&
          isNodeOfType(property.key, "Identifier") &&
          property.key.name === key &&
          isNodeOfType(property.value, "Identifier") &&
          scopes.symbolFor(property.value) === stateSymbol,
      )
    )
      return null;
  }
  snapshotReads.push(assignment.left.object);
  if (
    snapshot.references.length !== snapshotReads.length ||
    snapshot.references.some((reference) => !snapshotReads.includes(reference.identifier))
  )
    return null;
  if (index === 1) {
    const zeroGuard = body[0];
    if (
      !isNodeOfType(zeroGuard, "IfStatement") ||
      zeroGuard.alternate ||
      !directReturn(zeroGuard.consequent)
    )
      return null;
    const zeroTest = stripParenExpression(zeroGuard.test);
    if (!isNodeOfType(zeroTest, "LogicalExpression") || zeroTest.operator !== "&&") return null;
    for (const [raw, dimension] of [
      [zeroTest.left, dimensions[0]],
      [zeroTest.right, dimensions[1]],
    ] as const) {
      const comparison = stripParenExpression(raw);
      if (
        !isNodeOfType(comparison, "BinaryExpression") ||
        comparison.operator !== "===" ||
        !isNodeOfType(comparison.left, "Identifier") ||
        scopes.symbolFor(comparison.left) !== dimension.stateSymbol ||
        !literal(comparison.right, 0)
      )
        return null;
    }
  }
  let writeStatement: EsTreeNode = writeNode;
  while (writeStatement.parent && writeStatement.parent !== callback.body)
    writeStatement = writeStatement.parent;
  if (
    writeStatement.parent !== callback.body ||
    body.findIndex((candidate) => candidate === writeStatement) <= index + 2
  )
    return null;
  return {
    effectCallback: callback,
    owner: owner!,
    snapshotSymbol: snapshot,
    dimensions,
    recaptureStatement: recapture,
  };
};
