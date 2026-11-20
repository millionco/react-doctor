import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EffectStateWriteSite } from "./collect-effect-state-write-facts.js";

const globalName = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

const windowCheck = (raw: EsTreeNode, present: boolean, scopes: ScopeAnalysis): boolean => {
  const node = stripParenExpression(raw);
  return (
    isNodeOfType(node, "BinaryExpression") &&
    node.operator === (present ? "!==" : "===") &&
    isNodeOfType(node.left, "UnaryExpression") &&
    node.left.operator === "typeof" &&
    globalName(node.left.argument, "window", scopes) &&
    isNodeOfType(node.right, "Literal") &&
    node.right.value === "undefined"
  );
};

const loneStatement = (node: EsTreeNode): EsTreeNode | null =>
  isNodeOfType(node, "BlockStatement") ? (node.body.length === 1 ? node.body[0] : null) : node;

const falseReturn = (node: EsTreeNode): boolean => {
  const statement = loneStatement(node);
  return (
    isNodeOfType(statement, "ReturnStatement") && readStaticBoolean(statement.argument) === false
  );
};

const sameBinding = (left: EsTreeNode, right: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(left, "Identifier") &&
  isNodeOfType(right, "Identifier") &&
  Boolean(scopes.symbolFor(left)) &&
  scopes.symbolFor(left) === scopes.symbolFor(right);

const readOnly = (binding: SymbolDescriptor | null, scopes: ScopeAnalysis): boolean =>
  Boolean(
    binding &&
    isSymbolReadOnly(binding) &&
    hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) &&
    binding.references.every(({ identifier }) => !isWithinAssignmentTarget(identifier)),
  );

const stockHookCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const binding = scopes.symbolFor(node.callee);
  const declaration = binding && getImportDeclarationForSymbol(binding);
  return Boolean(
    binding &&
    readOnly(binding, scopes) &&
    declaration &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    !declaration.attributes?.length &&
    isNodeOfType(binding.declarationNode, "ImportSpecifier") &&
    binding.declarationNode.importKind !== "type" &&
    getImportedName(binding.declarationNode) === name,
  );
};

const hasClosedReactImports = (scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(scopes.rootScope.node, "Program")) return false;
  return scopes.rootScope.node.body.every((statement) => {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.source.value !== "react" ||
      statement.importKind === "type"
    )
      return true;
    if (statement.attributes?.length) return false;
    return statement.specifiers.every((specifier) => {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
        return true;
      const binding = scopes.symbolFor(specifier.local);
      if (!readOnly(binding, scopes)) return false;
      return Boolean(
        binding?.references.every(({ identifier }) => {
          if (isTypeScriptTypePosition(identifier)) return true;
          let root = findTransparentExpressionRoot(identifier);
          if (isNodeOfType(specifier, "ImportSpecifier")) {
            if (!/^use[A-Z]/.test(getImportedName(specifier) ?? "")) return false;
          } else {
            const member = root.parent;
            if (
              !isNodeOfType(member, "MemberExpression") ||
              member.computed ||
              member.optional ||
              !isNodeOfType(member.property, "Identifier") ||
              !/^use[A-Z]/.test(member.property.name)
            )
              return false;
            root = findTransparentExpressionRoot(member);
          }
          return (
            isNodeOfType(root.parent, "CallExpression") &&
            !root.parent.optional &&
            root.parent.callee === root
          );
        }),
      );
    });
  });
};

const localFunction = (
  call: EsTreeNode,
  arity: number,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== arity ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.some((arg) => isNodeOfType(arg, "SpreadElement"))
  )
    return null;
  const binding = scopes.symbolFor(call.callee);
  if (!readOnly(binding, scopes) || !binding) return null;
  const fn =
    binding.kind === "function" ? binding.declarationNode : getDirectConstInitializer(binding);
  if (
    !isFunctionLike(fn) ||
    fn.async ||
    fn.generator ||
    fn.params.length !== arity ||
    !fn.params.every(
      (parameter) =>
        isNodeOfType(parameter, "Identifier") && readOnly(scopes.symbolFor(parameter), scopes),
    ) ||
    isNodeOfType(binding.declarationNode.parent, "ExportNamedDeclaration") ||
    isNodeOfType(binding.declarationNode.parent?.parent, "ExportNamedDeclaration")
  )
    return null;
  return binding.references.every(({ identifier }) => {
    const callee = findTransparentExpressionRoot(identifier);
    return (
      isNodeOfType(callee.parent, "CallExpression") &&
      !callee.parent.optional &&
      callee.parent.callee === callee &&
      callee.parent.arguments.length === arity
    );
  })
    ? fn
    : null;
};

const memberCall = (node: EsTreeNode, method: string, arity: number): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === arity &&
  !node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  !node.callee.computed &&
  getStaticPropertyName(node.callee) === method;

// A raw-query bypass itself reads the browser URL. It is not an arbitrary
// helper-name exemption and cannot be replaced by a prop-derived predicate.
const rawQueryFunction = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
  allowed: Set<EsTreeNode>,
): EsTreeNode | null => {
  const fn = localFunction(call, 0, scopes);
  if (
    !fn ||
    !isFunctionLike(fn) ||
    !isNodeOfType(fn.body, "BlockStatement") ||
    (fn.body.body.length !== 2 && fn.body.body.length !== 3)
  )
    return null;
  const [exit] = fn.body.body;
  if (
    !isNodeOfType(exit, "IfStatement") ||
    exit.alternate ||
    !windowCheck(exit.test, false, scopes) ||
    !falseReturn(exit.consequent)
  )
    return null;
  const last = fn.body.body.at(-1);
  if (!isNodeOfType(last, "ReturnStatement") || !last.argument) return null;
  const has = stripParenExpression(last.argument);
  if (
    !memberCall(has, "has", 1) ||
    !isNodeOfType(has, "CallExpression") ||
    !isNodeOfType(has.arguments[0], "Literal") ||
    typeof has.arguments[0].value !== "string" ||
    !isNodeOfType(has.callee, "MemberExpression")
  )
    return null;
  let construction = stripParenExpression(has.callee.object);
  if (fn.body.body.length === 3) {
    const declaration = fn.body.body[1];
    if (
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const" ||
      declaration.declarations.length !== 1
    )
      return null;
    const variable = declaration.declarations[0];
    if (
      !isNodeOfType(variable.id, "Identifier") ||
      !variable.init ||
      !sameBinding(variable.id, construction, scopes)
    )
      return null;
    const binding = scopes.symbolFor(variable.id);
    if (!readOnly(binding, scopes) || binding?.references.length !== 1) return null;
    construction = stripParenExpression(variable.init);
  }
  if (
    !isNodeOfType(construction, "NewExpression") ||
    construction.arguments.length !== 1 ||
    !globalName(construction.callee, "URLSearchParams", scopes)
  )
    return null;
  const search = construction.arguments[0];
  if (
    !isNodeOfType(search, "MemberExpression") ||
    search.computed ||
    search.optional ||
    getStaticPropertyName(search) !== "search" ||
    !isNodeOfType(search.object, "MemberExpression") ||
    search.object.computed ||
    search.object.optional ||
    getStaticPropertyName(search.object) !== "location" ||
    !globalName(search.object.object, "window", scopes)
  )
    return null;
  allowed.add(construction.callee);
  allowed.add(search.object.object);
  return fn;
};

interface StorageCompletion {
  readonly rawQuery: EsTreeNode;
  readonly value: string;
}

const readStorageFunction = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
  allowed: Set<EsTreeNode>,
): StorageCompletion | null => {
  const fn = localFunction(call, 1, scopes);
  if (!fn || !isFunctionLike(fn) || !isNodeOfType(fn.body, "BlockStatement")) return null;
  const statements = fn.body.body;
  let rawCall: EsTreeNode | null = null;
  if (statements.length === 3) {
    const [serverExit, rawExit] = statements;
    if (
      !isNodeOfType(serverExit, "IfStatement") ||
      serverExit.alternate ||
      !windowCheck(serverExit.test, false, scopes) ||
      !falseReturn(serverExit.consequent) ||
      !isNodeOfType(rawExit, "IfStatement") ||
      rawExit.alternate ||
      !falseReturn(rawExit.consequent)
    )
      return null;
    rawCall = rawExit.test;
  } else if (statements.length === 2) {
    const [exit] = statements;
    if (
      !isNodeOfType(exit, "IfStatement") ||
      exit.alternate ||
      !falseReturn(exit.consequent) ||
      !isNodeOfType(exit.test, "LogicalExpression") ||
      exit.test.operator !== "||" ||
      !windowCheck(exit.test.left, false, scopes)
    )
      return null;
    rawCall = exit.test.right;
  } else return null;
  const raw = rawQueryFunction(rawCall, scopes, allowed);
  const last = statements.at(-1);
  if (
    !raw ||
    !isNodeOfType(last, "ReturnStatement") ||
    !last.argument ||
    !isNodeOfType(last.argument, "BinaryExpression") ||
    last.argument.operator !== "===" ||
    !isNodeOfType(last.argument.right, "Literal") ||
    typeof last.argument.right.value !== "string"
  )
    return null;
  const read = last.argument.left;
  if (
    !memberCall(read, "getItem", 1) ||
    !isNodeOfType(read, "CallExpression") ||
    !isNodeOfType(read.callee, "MemberExpression") ||
    !globalName(read.callee.object, "localStorage", scopes) ||
    !sameBinding(read.arguments[0], fn.params[0], scopes)
  )
    return null;
  allowed.add(read.callee.object);
  return { rawQuery: raw, value: last.argument.right.value };
};

const writeStorageFunction = (
  call: EsTreeNode,
  completion: StorageCompletion,
  scopes: ScopeAnalysis,
  allowed: Set<EsTreeNode>,
): boolean => {
  const fn = localFunction(call, 1, scopes);
  if (
    !fn ||
    !isFunctionLike(fn) ||
    !isNodeOfType(fn.body, "BlockStatement") ||
    fn.body.body.length !== 1
  )
    return false;
  const guard = fn.body.body[0];
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "LogicalExpression") ||
    guard.test.operator !== "&&" ||
    !windowCheck(guard.test.left, true, scopes) ||
    !isNodeOfType(guard.test.right, "UnaryExpression") ||
    guard.test.right.operator !== "!" ||
    rawQueryFunction(guard.test.right.argument, scopes, allowed) !== completion.rawQuery
  )
    return false;
  const statement = loneStatement(guard.consequent);
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const write = statement.expression;
  if (
    !memberCall(write, "setItem", 2) ||
    !isNodeOfType(write, "CallExpression") ||
    !isNodeOfType(write.callee, "MemberExpression") ||
    !globalName(write.callee.object, "localStorage", scopes) ||
    !sameBinding(write.arguments[0], fn.params[0], scopes) ||
    !isNodeOfType(write.arguments[1], "Literal") ||
    write.arguments[1].value !== completion.value
  )
    return false;
  allowed.add(write.callee.object);
  return true;
};

const CRITICAL_BROWSER_NAMES: ReadonlySet<string> = new Set([
  "window",
  "localStorage",
  "sessionStorage",
  "Storage",
  "Window",
  "URLSearchParams",
  "document",
  "globalThis",
  "global",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "eval",
  "Function",
  "require",
  "module",
  "event",
  "frameElement",
  "arguments",
  "addEventListener",
  "removeEventListener",
  "open",
]);
const AMBIENT_PROVIDER_ACCESSORS: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "defaultView",
]);

// Browsers also accept source text as a timer handler. Require a visible
// callable so an escaped timer or an implicit string evaluation is not ignored.
const isCallableTimerUse = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callee = findTransparentExpressionRoot(identifier);
  const call = callee.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.callee !== callee ||
    !call.arguments[0]
  )
    return false;
  const handler = stripParenExpression(call.arguments[0]);
  if (isFunctionLike(handler)) return true;
  if (!isNodeOfType(handler, "Identifier")) return false;
  const binding = scopes.symbolFor(handler);
  if (!binding || !readOnly(binding, scopes)) return false;
  return isFunctionLike(
    binding.kind === "function" ? binding.declarationNode : getDirectConstInitializer(binding),
  );
};

const hasClosedStorageProviders = (scopes: ScopeAnalysis, allowed: Set<EsTreeNode>): boolean => {
  let invalid = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (invalid) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "WithStatement")
    ) {
      invalid = true;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      AMBIENT_PROVIDER_ACCESSORS.has(getStaticPropertyName(node) ?? "")
    ) {
      invalid = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node) || allowed.has(node))
      return;
    if (node.name === "setTimeout" || node.name === "setInterval") {
      if (!isCallableTimerUse(node, scopes)) {
        invalid = true;
        return false;
      }
      return;
    }
    const isAmbientHandlerAssignment = node.name.startsWith("on") && isWithinAssignmentTarget(node);
    if (!CRITICAL_BROWSER_NAMES.has(node.name) && !isAmbientHandlerAssignment) return;
    if (
      node.name === "window" &&
      isNodeOfType(node.parent, "UnaryExpression") &&
      node.parent.operator === "typeof"
    )
      return;
    if (
      node.name === "document" &&
      isNodeOfType(node.parent, "MemberExpression") &&
      !node.parent.computed &&
      !node.parent.optional &&
      getStaticPropertyName(node.parent) === "title" &&
      isNodeOfType(node.parent.parent, "AssignmentExpression") &&
      node.parent.parent.operator === "=" &&
      node.parent.parent.left === node.parent
    )
      return;
    invalid = true;
    return false;
  });
  return !invalid;
};

const onlyEffectGuardReads = (state: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  state.references.every(({ identifier, flag }) => {
    if (flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
    let root = findTransparentExpressionRoot(identifier);
    if (isNodeOfType(root.parent, "ArrayExpression")) {
      const dependencies = root.parent;
      const call = dependencies.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.arguments[1] === dependencies &&
        stockHookCall(call, "useEffect", scopes)
      );
    }
    while (
      (isNodeOfType(root.parent, "UnaryExpression") && root.parent.operator === "!") ||
      isNodeOfType(root.parent, "LogicalExpression")
    )
      root = root.parent;
    const statement = root.parent;
    if (!isNodeOfType(statement, "IfStatement") || statement.test !== root) return false;
    const fn = findEnclosingFunction(statement);
    const call = fn?.parent;
    return Boolean(
      fn &&
      isNodeOfType(call, "CallExpression") &&
      call.arguments[0] === fn &&
      stockHookCall(call, "useEffect", scopes),
    );
  });

export const isPrivateStorageInitializationWrite = (
  write: EffectStateWriteSite,
  context: RuleContext,
): boolean => {
  const scopes = context.scopes;
  if (readStaticBoolean(write.value) !== true || !isNodeOfType(write.node, "CallExpression"))
    return false;
  const pair = resolveReactUseStatePair(write.setter, scopes);
  if (
    !pair?.stateSymbol ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !stockHookCall(pair.declarator.init, "useState", scopes) ||
    readStaticBoolean(pair.declarator.init.arguments[0]) !== false ||
    !readOnly(pair.stateSymbol, scopes) ||
    !readOnly(pair.setterSymbol, scopes) ||
    pair.setterSymbol.references.length !== 1 ||
    pair.setterSymbol.references[0].identifier !== write.setter ||
    !onlyEffectGuardReads(pair.stateSymbol, scopes) ||
    !hasClosedReactImports(scopes)
  )
    return false;
  const effect = findEnclosingFunction(write.node);
  const call = effect?.parent;
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    effect.params.length ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    effect.body.body.length !== 2 ||
    !isNodeOfType(call, "CallExpression") ||
    call.arguments[0] !== effect ||
    !stockHookCall(call, "useEffect", scopes)
  )
    return false;
  const [doneExit, client] = effect.body.body;
  if (
    !isNodeOfType(doneExit, "IfStatement") ||
    doneExit.alternate ||
    !isNodeOfType(doneExit.test, "Identifier") ||
    scopes.symbolFor(doneExit.test) !== pair.stateSymbol ||
    !isNodeOfType(doneExit.consequent, "ReturnStatement") ||
    doneExit.consequent.argument ||
    !isNodeOfType(client, "IfStatement") ||
    client.alternate ||
    !windowCheck(client.test, true, scopes) ||
    !isNodeOfType(client.consequent, "BlockStatement") ||
    client.consequent.body.length !== 3
  )
    return false;
  const [declaration, completed, marker] = client.consequent.body;
  if (
    !isNodeOfType(marker, "ExpressionStatement") ||
    marker.expression !== write.node ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(completed, "IfStatement") ||
    completed.alternate ||
    !isNodeOfType(completed.consequent, "BlockStatement") ||
    completed.consequent.body.length < 1
  )
    return false;
  const variable = declaration.declarations[0];
  const value = variable.init;
  if (
    !isNodeOfType(variable.id, "Identifier") ||
    !isNodeOfType(value, "LogicalExpression") ||
    value.operator !== "||" ||
    !isNodeOfType(value.left, "Identifier") ||
    !readOnly(scopes.symbolFor(value.left), scopes) ||
    !isNodeOfType(value.right, "CallExpression") ||
    !isNodeOfType(value.right.arguments[0], "Identifier") ||
    !readOnly(scopes.symbolFor(value.right.arguments[0]), scopes) ||
    !sameBinding(completed.test, variable.id, scopes)
  )
    return false;
  const writeGuard = completed.consequent.body[0];
  const statement = isNodeOfType(writeGuard, "IfStatement")
    ? loneStatement(writeGuard.consequent)
    : null;
  if (
    !isNodeOfType(writeGuard, "IfStatement") ||
    writeGuard.alternate ||
    !sameBinding(writeGuard.test, value.left, scopes) ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "CallExpression") ||
    !sameBinding(statement.expression.arguments[0], value.right.arguments[0], scopes)
  )
    return false;
  const allowed = new Set<EsTreeNode>();
  const raw = readStorageFunction(value.right, scopes, allowed);
  if (!raw || !writeStorageFunction(statement.expression, raw, scopes, allowed)) return false;
  let exitsBeforeMarker = false;
  walkAst(completed.consequent, (node) => {
    if (node !== completed.consequent && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "ReturnStatement") ||
      isNodeOfType(node, "ThrowStatement") ||
      isNodeOfType(node, "BreakStatement") ||
      isNodeOfType(node, "ContinueStatement")
    )
      exitsBeforeMarker = true;
  });
  return !exitsBeforeMarker && hasClosedStorageProviders(scopes, allowed);
};
