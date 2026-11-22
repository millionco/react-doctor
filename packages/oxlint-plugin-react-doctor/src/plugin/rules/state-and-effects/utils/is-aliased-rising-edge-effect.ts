import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";

const isNamedReactCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (call.optional || !isNodeOfType(call.callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(call.callee);
  if (
    !symbol ||
    !isSymbolReadOnly(symbol) ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== name
  )
    return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return (
    declaration?.source.value === "react" &&
    declaration.importKind !== "type" &&
    !declaration.attributes?.length
  );
};

const standardReactImportByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasOnlyNamedReactImports = (scopes: ScopeAnalysis): boolean => {
  const cached = standardReactImportByScope.get(scopes);
  if (cached !== undefined) return cached;
  let namedOnly = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!namedOnly) return false;
    if (
      (isNodeOfType(node, "ImportDeclaration") &&
        node.source.value === "react" &&
        node.importKind !== "type" &&
        !node.specifiers.every((specifier) => {
          if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
          const name = getImportedName(specifier);
          return typeof name === "string" && /^use[A-Z]/.test(name);
        })) ||
      (isNodeOfType(node, "Identifier") &&
        (node.name === "require" ||
          node.name === "eval" ||
          node.name === "Function" ||
          node.name === "arguments") &&
        scopes.isGlobalReference(node)) ||
      isNodeOfType(node, "ImportExpression")
    ) {
      namedOnly = false;
      return false;
    }
  });
  standardReactImportByScope.set(scopes, namedOnly);
  return namedOnly;
};

const readRefIdentifier = (
  expression: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"Identifier"> | null =>
  isNodeOfType(expression, "MemberExpression") &&
  !expression.computed &&
  !expression.optional &&
  isNodeOfType(expression.property, "Identifier") &&
  expression.property.name === "current" &&
  isNodeOfType(expression.object, "Identifier")
    ? expression.object
    : null;

const isUnconditionalReturn = (statement: EsTreeNode): boolean => {
  const returned =
    isNodeOfType(statement, "BlockStatement") && statement.body.length === 1
      ? statement.body[0]
      : statement;
  return isNodeOfType(returned, "ReturnStatement") && !returned.argument;
};

export const isAliasedRisingEdgeEffect = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression" | "FunctionExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    callback.async ||
    (isNodeOfType(callback, "FunctionExpression") && callback.generator) ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return false;
  const [snapshot, update, guard] = callback.body.body;
  if (
    !isNodeOfType(snapshot, "VariableDeclaration") ||
    snapshot.kind !== "const" ||
    snapshot.declarations.length !== 1 ||
    !isNodeOfType(update, "ExpressionStatement") ||
    !isNodeOfType(update.expression, "AssignmentExpression") ||
    update.expression.operator !== "=" ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isUnconditionalReturn(guard.consequent)
  )
    return false;

  const previous = snapshot.declarations[0];
  const read = readRefIdentifier(previous.init);
  const write = readRefIdentifier(update.expression.left);
  const signal = stripParenExpression(update.expression.right);
  const condition = stripParenExpression(guard.test);
  if (
    !read ||
    !write ||
    !isNodeOfType(previous.id, "Identifier") ||
    !isNodeOfType(signal, "Identifier") ||
    !isNodeOfType(condition, "LogicalExpression") ||
    condition.operator !== "||" ||
    !isNodeOfType(condition.left, "UnaryExpression") ||
    condition.left.operator !== "!" ||
    !isNodeOfType(condition.left.argument, "Identifier") ||
    !isNodeOfType(condition.right, "Identifier")
  )
    return false;

  const effect = callback.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    !isNamedReactCall(effect, "useEffect", scopes) ||
    callback.params.length !== 0 ||
    effect.arguments.length !== 2 ||
    !isNodeOfType(effect.arguments[1], "ArrayExpression") ||
    effect.arguments[1].elements.some(
      (element) => !element || isNodeOfType(element, "SpreadElement"),
    )
  )
    return false;
  const ref = scopes.symbolFor(read);
  const signalSymbol = scopes.symbolFor(signal);
  const snapshotSymbol = scopes.symbolFor(previous.id);
  if (
    !signalSymbol ||
    !effect.arguments[1].elements.some(
      (element) =>
        isNodeOfType(element, "Identifier") && scopes.symbolFor(element) === signalSymbol,
    ) ||
    !snapshotSymbol ||
    !isSymbolReadOnly(snapshotSymbol) ||
    snapshotSymbol.references.length !== 1 ||
    snapshotSymbol.references[0].identifier !== condition.right
  )
    return false;
  if (
    !ref ||
    scopes.symbolFor(write) !== ref ||
    ref.references.length !== 2 ||
    !ref.references.every(({ identifier }) => identifier === read || identifier === write) ||
    !signalSymbol ||
    !isSymbolReadOnly(signalSymbol) ||
    scopes.symbolFor(condition.left.argument) !== signalSymbol ||
    scopes.symbolFor(condition.right)?.bindingIdentifier !== previous.id
  )
    return false;

  const initializer = getDirectConstInitializer(ref);
  if (
    findEnclosingFunction(ref.declarationNode) !== findEnclosingFunction(callback) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    initializer.arguments.length !== 1 ||
    !isNodeOfType(initializer.arguments[0], "Literal") ||
    initializer.arguments[0].value !== false
  )
    return false;

  // No keyboard/provider origin is inferred: a private stock React ref records
  // the current signal before the effect can notify, independently of its source.
  // Other dependency changes cannot notify again while the signal stays high.
  return isNamedReactCall(initializer, "useRef", scopes) && hasOnlyNamedReactImports(scopes);
};
