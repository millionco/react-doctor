import type { RuleContext } from "../../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
const expressionStatement = (node: EsTreeNode | undefined): EsTreeNode | null =>
  node && isNodeOfType(node, "ExpressionStatement") ? node.expression : null;

const blockStatements = (node: EsTreeNode): readonly EsTreeNode[] | null =>
  isNodeOfType(node, "BlockStatement") ? node.body : null;

const isLiteral = (node: EsTreeNode | undefined, value: unknown): boolean =>
  Boolean(node && isNodeOfType(node, "Literal") && node.value === value);

const plainMember = (node: EsTreeNode | undefined, key: string): EsTreeNode | null => {
  if (
    !node ||
    !isNodeOfType(node, "MemberExpression") ||
    node.computed ||
    node.optional ||
    !isNodeOfType(node.property, "Identifier") ||
    node.property.name !== key
  )
    return null;
  return node.object;
};

const constBinding = (node: EsTreeNode | undefined) => {
  if (
    !node ||
    !isNodeOfType(node, "VariableDeclaration") ||
    node.kind !== "const" ||
    node.declarations.length !== 1
  )
    return null;
  const declaration = node.declarations[0];
  return declaration && isNodeOfType(declaration.id, "Identifier") && declaration.init
    ? { id: declaration.id, value: stripParenExpression(declaration.init) }
    : null;
};

const arrowBody = (node: EsTreeNode | null): readonly EsTreeNode[] | null =>
  node && isNodeOfType(node, "ArrowFunctionExpression") && !node.async && node.params.length === 0
    ? blockStatements(node.body)
    : null;

const sameBinding = (
  left: EsTreeNode | null | undefined,
  right: EsTreeNode,
  scopes: ScopeAnalysis,
) =>
  Boolean(
    left &&
    isNodeOfType(left, "Identifier") &&
    scopes.symbolFor(left) &&
    scopes.symbolFor(left) === scopes.symbolFor(right),
  );

const closedReferences = (
  binding: EsTreeNode,
  allowed: readonly EsTreeNode[],
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(binding, "Identifier")) return false;
  const symbol = scopes.symbolFor(binding);
  return Boolean(
    symbol &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
    symbol.references.length === allowed.length &&
    symbol.references.every(
      (reference) => reference.flag === "read" && allowed.includes(reference.identifier),
    ),
  );
};

const resolveLiteral = (
  node: EsTreeNode | null,
  resolve: EsTreeNode,
  value: boolean,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (
    !node ||
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== 1 ||
    !sameBinding(node.callee, resolve, scopes) ||
    !isLiteral(node.arguments[0], value)
  )
    return null;
  return node.callee;
};

const signalMethod = (
  node: EsTreeNode | null,
  signal: EsTreeNode,
  method: "addEventListener" | "removeEventListener",
  listener: EsTreeNode,
  scopes: ScopeAnalysis,
): { signal: EsTreeNode; listener: EsTreeNode } | null => {
  if (
    !node ||
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== (method === "addEventListener" ? 3 : 2)
  )
    return null;
  const receiver = plainMember(node.callee, method);
  if (
    !sameBinding(receiver, signal, scopes) ||
    !isLiteral(node.arguments[0], "abort") ||
    !sameBinding(node.arguments[1], listener, scopes)
  )
    return null;
  if (method === "addEventListener") {
    const options = node.arguments[2];
    if (!isNodeOfType(options, "ObjectExpression") || options.properties.length !== 1) return null;
    const property = options.properties[0];
    if (
      !property ||
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name !== "once" ||
      !isLiteral(property.value, true)
    )
      return null;
  }
  return { signal: receiver!, listener: node.arguments[1]! };
};

// Function declarations have both outer and recursive-name symbols. Inspect
// every symbol for the exact declaration; symbolFor(helper.id) alone misses
// the outer call sites in the normal oxc scope model.
const closedHelperInvocations = (
  helper: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode[] | null => {
  const pending = [scopes.rootScope];
  const invocations = new Set<EsTreeNode>();
  let found = false;
  while (pending.length) {
    const scope = pending.pop()!;
    pending.push(...scope.children);
    for (const symbol of scope.symbols) {
      if (symbol.declarationNode !== helper) continue;
      found = true;
      if (!hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)) return null;
      for (const reference of symbol.references) {
        const invocation = reference.identifier.parent;
        if (
          reference.flag !== "read" ||
          !isNodeOfType(invocation, "CallExpression") ||
          invocation.optional ||
          invocation.callee !== reference.identifier ||
          !isNodeOfType(findTransparentExpressionRoot(invocation).parent, "AwaitExpression")
        )
          return null;
        invocations.add(invocation);
      }
    }
  }
  return found && invocations.size > 0 ? [...invocations] : null;
};

const nativeTimer = (node: EsTreeNode, method: string, scopes: ScopeAnalysis): boolean => {
  const host = plainMember(node, method);
  return Boolean(
    host &&
    isNodeOfType(host, "Identifier") &&
    host.name === "window" &&
    isProvenUnmodifiedGlobalNamespaceReference(host, null, scopes, method, true),
  );
};

// Only the closed native timer callback may settle the promise with true.
export const isClosedBooleanTimerWaiter = (
  functionNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const scopes = context.scopes;
  const helper = functionNode;
  if (
    !isNodeOfType(helper, "FunctionDeclaration") ||
    helper.async ||
    helper.generator ||
    !helper.id ||
    !isNodeOfType(helper.parent, "Program") ||
    helper.params.length !== 2 ||
    !helper.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  )
    return false;
  const [ms, signal] = helper.params;
  if (!ms || !signal) return false;
  let canUseNativeMethods = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!canUseNativeMethods) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval")
    ) {
      canUseNativeMethods = false;
      return false;
    }
    const name =
      isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)
        ? node.name
        : isNodeOfType(node, "MemberExpression")
          ? getStaticPropertyName(node)
          : null;
    if (
      (name === "AbortSignal" || name === "EventTarget") &&
      !isProvenUnmodifiedGlobalNamespaceReference(node, name, scopes, undefined, true)
    ) {
      canUseNativeMethods = false;
      return false;
    }
    return undefined;
  });
  if (!canUseNativeMethods) return false;
  const body = blockStatements(helper.body);
  const returned = body?.length === 1 && body[0];
  if (!returned || !isNodeOfType(returned, "ReturnStatement") || !returned.argument) return false;
  const promise = stripParenExpression(returned.argument);
  if (
    !isNodeOfType(promise, "NewExpression") ||
    promise.arguments.length !== 1 ||
    !isNodeOfType(promise.callee, "Identifier") ||
    promise.callee.name !== "Promise" ||
    !isProvenUnmodifiedGlobalNamespaceReference(promise.callee, "Promise", scopes, undefined, true)
  )
    return false;
  const executor = promise.arguments[0];
  if (
    !executor ||
    !isNodeOfType(executor, "ArrowFunctionExpression") ||
    executor.async ||
    executor.params.length !== 1 ||
    !isNodeOfType(executor.params[0], "Identifier")
  )
    return false;
  const resolve = executor.params[0];
  const statements = blockStatements(executor.body);
  if (!statements || statements.length !== 4) return false;
  const [initial, abortDeclaration, timerDeclaration, registration] = statements;
  if (!initial || !isNodeOfType(initial, "IfStatement") || initial.alternate) return false;
  const abortedReceiver = plainMember(stripParenExpression(initial.test), "aborted");
  if (
    !sameBinding(abortedReceiver, signal, scopes) ||
    !isNodeOfType(initial.consequent, "ReturnStatement")
  )
    return false;
  const initialResolve = resolveLiteral(
    initial.consequent.argument ?? null,
    resolve,
    false,
    scopes,
  );
  const abort = constBinding(abortDeclaration);
  const timer = constBinding(timerDeclaration);
  const abortBody = abort && arrowBody(abort.value);
  if (!initialResolve || !abort || !timer || !abortBody || abortBody.length !== 2) return false;
  const clearing = expressionStatement(abortBody[0]);
  if (
    !clearing ||
    !isNodeOfType(clearing, "CallExpression") ||
    clearing.optional ||
    clearing.arguments.length !== 1 ||
    !nativeTimer(clearing.callee, "clearTimeout", scopes) ||
    !sameBinding(clearing.arguments[0], timer.id, scopes)
  )
    return false;
  const abortResolve = resolveLiteral(expressionStatement(abortBody[1]), resolve, false, scopes);
  if (
    !abortResolve ||
    !isNodeOfType(timer.value, "CallExpression") ||
    timer.value.optional ||
    timer.value.arguments.length !== 2 ||
    !nativeTimer(timer.value.callee, "setTimeout", scopes) ||
    !sameBinding(timer.value.arguments[1], ms, scopes)
  )
    return false;
  const elapsedBody = arrowBody(timer.value.arguments[0] ?? null);
  if (!elapsedBody || elapsedBody.length !== 2) return false;
  const removing = signalMethod(
    expressionStatement(elapsedBody[0]),
    signal,
    "removeEventListener",
    abort.id,
    scopes,
  );
  const elapsedResolve = resolveLiteral(expressionStatement(elapsedBody[1]), resolve, true, scopes);
  const adding = signalMethod(
    expressionStatement(registration),
    signal,
    "addEventListener",
    abort.id,
    scopes,
  );
  if (!removing || !elapsedResolve || !adding) return false;
  if (
    !closedReferences(resolve, [initialResolve, abortResolve, elapsedResolve], scopes) ||
    !closedReferences(signal, [abortedReceiver!, removing.signal, adding.signal], scopes) ||
    !closedReferences(ms, [timer.value.arguments[1]!], scopes) ||
    !closedReferences(timer.id, [clearing.arguments[0]!], scopes) ||
    !closedReferences(abort.id, [removing.listener, adding.listener], scopes)
  )
    return false;
  return closedHelperInvocations(helper, scopes) !== null;
};
