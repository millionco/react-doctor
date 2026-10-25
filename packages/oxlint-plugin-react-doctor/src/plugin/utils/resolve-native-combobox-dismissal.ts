import { TIMER_CLEANUP_CALLEE_NAMES } from "../constants/dom.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { ComboboxOpenDispatcher } from "./resolve-combobox-open-dispatcher.js";
import { COMBOBOX_MIN_DISMISS_DELAY_MS } from "./constants.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getCallbackStatements } from "./get-callback-statements.js";
import { getLocalComboboxCallback } from "./get-local-combobox-callback.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isFunctionLike } from "./is-function-like.js";
import { isGlobalBrowserFunctionCall } from "./is-global-browser-function-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export interface NativeComboboxDismissal {
  readonly closingState: SymbolDescriptor;
  readonly callbackSymbol: SymbolDescriptor;
}

const currentSymbol = (expression: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  const member = stripParenExpression(expression);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    getStaticPropertyName(member) !== "current"
  )
    return null;
  const identifier = stripParenExpression(member.object);
  return isNodeOfType(identifier, "Identifier") ? scopes.symbolFor(identifier) : null;
};

const ownRef = (
  symbol: SymbolDescriptor,
  initial: boolean | null,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    hasSymbolBindingWrites(symbol) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  )
    return false;
  const call = stripParenExpression(symbol.initializer);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isProvenUnmodifiedReactApiCall(call, "useRef", scopes) ||
    findEnclosingFunction(call) !== owner
  )
    return false;
  const value = call.arguments[0];
  if (!value) return false;
  const literal = stripParenExpression(value);
  return isNodeOfType(literal, "Literal") && literal.value === initial;
};

const assignment = (statement: EsTreeNode): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  const expression = isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;
  return isNodeOfType(expression, "AssignmentExpression") && expression.operator === "="
    ? expression
    : null;
};

const literalAssignment = (
  statement: EsTreeNode,
  symbol: SymbolDescriptor,
  expected: boolean | null,
  scopes: ScopeAnalysis,
): boolean => {
  const write = assignment(statement);
  if (!write || currentSymbol(write.left, scopes) !== symbol) return false;
  const value = stripParenExpression(write.right);
  return isNodeOfType(value, "Literal") && value.value === expected;
};

const booleanSetter = (
  expression: EsTreeNode,
  value: boolean,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1)
    return null;
  const argument = call.arguments[0];
  if (!argument || !isNodeOfType(stripParenExpression(argument), "Literal")) return null;
  const literal = stripParenExpression(argument);
  if (!isNodeOfType(literal, "Literal") || literal.value !== value) return null;
  const pair = resolveReactUseStatePair(call.callee, scopes);
  if (
    !pair?.stateSymbol ||
    pair.stateSymbol.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    hasSymbolBindingWrites(pair.stateSymbol) ||
    hasSymbolBindingWrites(pair.setterSymbol) ||
    !pair.declarator.init ||
    !isProvenUnmodifiedReactApiCall(pair.declarator.init, "useState", scopes) ||
    findEnclosingFunction(pair.declarator) !== owner
  )
    return null;
  const initialCall = stripParenExpression(pair.declarator.init);
  if (!isNodeOfType(initialCall, "CallExpression") || initialCall.arguments.length !== 1)
    return null;
  const initial = initialCall.arguments[0];
  if (!initial || !isNodeOfType(stripParenExpression(initial), "Literal")) return null;
  const initialValue = stripParenExpression(initial);
  if (!isNodeOfType(initialValue, "Literal") || initialValue.value !== false) return null;
  const allowed = new Set<EsTreeNode>();
  for (const reference of pair.setterSymbol.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const invocation = root.parent;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.optional ||
      invocation.callee !== root ||
      invocation.arguments.length !== 1
    )
      return null;
    const parameter = invocation.arguments[0];
    if (!parameter) return null;
    const primitive = stripParenExpression(parameter);
    if (!isNodeOfType(primitive, "Literal") || typeof primitive.value !== "boolean") return null;
    allowed.add(reference.identifier);
  }
  return hasOnlyAllowedSymbolReads({
    symbol: pair.setterSymbol,
    allowedIdentifiers: allowed,
    program: scopes.rootScope.node,
    scopes,
  })
    ? pair.stateSymbol
    : null;
};

const isNullGuard = (
  statement: EsTreeNode,
  ticket: SymbolDescriptor,
  scopes: ScopeAnalysis,
): statement is EsTreeNodeOfType<"IfStatement"> => {
  if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
  const test = stripParenExpression(statement.test);
  const right = isNodeOfType(test, "BinaryExpression") ? stripParenExpression(test.right) : null;
  return Boolean(
    isNodeOfType(test, "BinaryExpression") &&
    test.operator === "!==" &&
    currentSymbol(test.left, scopes) === ticket &&
    isNodeOfType(right, "Literal") &&
    right.value === null,
  );
};

const isClear = (
  statement: EsTreeNode,
  ticket: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const call = stripParenExpression(statement.expression);
  return (
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.arguments.length === 1 &&
    isGlobalBrowserFunctionCall(call, "clearTimeout", scopes) &&
    Boolean(call.arguments[0] && currentSymbol(call.arguments[0], scopes) === ticket)
  );
};

const referencesIn = (
  nodes: EsTreeNode[],
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  allowed: Set<EsTreeNode>,
): void => {
  for (const node of nodes)
    walkAst(node, (child) => {
      if (
        isNodeOfType(child, "Identifier") &&
        scopes.symbolFor(child) === symbol &&
        scopes.referenceFor(child)
      )
        allowed.add(child);
    });
};

const isPhaseExit = (
  statement: EsTreeNode,
  phase: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
  const test = stripParenExpression(statement.test);
  const exit =
    isNodeOfType(statement.consequent, "BlockStatement") && statement.consequent.body.length === 1
      ? statement.consequent.body[0]
      : statement.consequent;
  return (
    isNodeOfType(test, "UnaryExpression") &&
    test.operator === "!" &&
    isNodeOfType(stripParenExpression(test.argument), "Identifier") &&
    scopes.symbolFor(stripParenExpression(test.argument)) === phase &&
    isNodeOfType(exit, "ReturnStatement") &&
    !exit.argument
  );
};

export const resolveNativeComboboxDismissal = (
  callee: EsTreeNode,
  dispatcher: ComboboxOpenDispatcher,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): NativeComboboxDismissal | null => {
  const callback = getLocalComboboxCallback(callee, scopes);
  if (
    !callback ||
    callback.node.params.length !== 0 ||
    callback.statements.length !== 4 ||
    findEnclosingFunction(callback.node) !== owner
  )
    return null;
  if (callback.wrapper) {
    const dependencies = callback.wrapper.arguments[1];
    if (
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length !== 1 ||
      !isNodeOfType(dependencies.elements[0], "Identifier") ||
      scopes.symbolFor(dependencies.elements[0]) !== dispatcher.callback.symbol
    )
      return null;
  }
  const [guard, busyWrite, busyStatement, timerStatement] = callback.statements;
  if (
    !guard ||
    !busyWrite ||
    !busyStatement ||
    !timerStatement ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "ReturnStatement") ||
    guard.consequent.argument
  )
    return null;
  const busy = currentSymbol(guard.test, scopes);
  if (
    !busy ||
    !ownRef(busy, false, owner, scopes) ||
    !literalAssignment(busyWrite, busy, true, scopes) ||
    !isNodeOfType(busyStatement, "ExpressionStatement")
  )
    return null;
  const closingState = booleanSetter(busyStatement.expression, true, owner, scopes);
  const timerWrite = assignment(timerStatement);
  const ticket = timerWrite ? currentSymbol(timerWrite.left, scopes) : null;
  if (!closingState || !timerWrite || !ticket || !ownRef(ticket, null, owner, scopes)) return null;
  const timer = stripParenExpression(timerWrite.right);
  if (
    !isNodeOfType(timer, "CallExpression") ||
    timer.optional ||
    timer.arguments.length !== 2 ||
    !isGlobalBrowserFunctionCall(timer, "setTimeout", scopes)
  )
    return null;
  const rawCallback = timer.arguments[0];
  if (!rawCallback) return null;
  const timerCallback = stripParenExpression(rawCallback);
  if (
    (!isNodeOfType(timerCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(timerCallback, "FunctionExpression")) ||
    timerCallback.async ||
    timerCallback.generator ||
    timerCallback.params.length !== 0
  )
    return null;
  const rawDelay = timer.arguments[1];
  if (!rawDelay) return null;
  let delay = stripParenExpression(rawDelay);
  if (isNodeOfType(delay, "Identifier")) {
    const delaySymbol = scopes.symbolFor(delay);
    if (
      delaySymbol?.kind !== "const" ||
      !delaySymbol.initializer ||
      hasSymbolBindingWrites(delaySymbol) ||
      !isNodeOfType(delaySymbol.declarationNode, "VariableDeclarator") ||
      delaySymbol.declarationNode.id !== delaySymbol.bindingIdentifier
    )
      return null;
    delay = stripParenExpression(delaySymbol.initializer);
  }
  if (
    !isNodeOfType(delay, "Literal") ||
    typeof delay.value !== "number" ||
    !Number.isFinite(delay.value) ||
    delay.value < COMBOBOX_MIN_DISMISS_DELAY_MS
  )
    return null;
  const timerStatements = getCallbackStatements(timerCallback);
  if (
    timerStatements.length !== 4 ||
    !timerStatements[0] ||
    !literalAssignment(timerStatements[0], busy, false, scopes)
  )
    return null;
  let dispatched = false;
  let closingReset = false;
  for (const statement of timerStatements.slice(1)) {
    if (!isNodeOfType(statement, "ExpressionStatement")) return null;
    const call = stripParenExpression(statement.expression);
    if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1)
      return null;
    const argument = call.arguments[0];
    if (!argument) return null;
    const value = stripParenExpression(argument);
    if (!isNodeOfType(value, "Literal") || value.value !== false) return null;
    if (
      isNodeOfType(call.callee, "Identifier") &&
      scopes.symbolFor(call.callee) === dispatcher.callback.symbol
    ) {
      if (dispatched) return null;
      dispatched = true;
    } else {
      const state = booleanSetter(call, false, owner, scopes);
      if (!state) return null;
      if (state === closingState) closingReset = true;
    }
  }
  if (!dispatched || !closingReset) return null;
  const busyReferences = new Set<EsTreeNode>();
  const ticketReferences = new Set<EsTreeNode>();
  referencesIn([guard, busyWrite, timerCallback], busy, scopes, busyReferences);
  referencesIn([timerWrite.left], ticket, scopes, ticketReferences);
  let effectsSupported = true;
  const admittedClears = new Set<EsTreeNode>();
  walkAst(owner, (node) => {
    if (
      !effectsSupported ||
      !isNodeOfType(node, "CallExpression") ||
      !isProvenUnmodifiedReactApiCall(node, "useEffect", scopes)
    )
      return;
    const effect = node.arguments[0];
    if (!isFunctionLike(effect) || effect.async || effect.generator || effect.params.length !== 0)
      return;
    const statements = getCallbackStatements(effect);
    const dependencies = node.arguments[1];
    if (
      statements.length >= 3 &&
      statements[0] &&
      statements[1] &&
      statements[2] &&
      isPhaseExit(statements[0], dispatcher.phase, scopes) &&
      isNullGuard(statements[1], ticket, scopes) &&
      literalAssignment(statements[2], busy, false, scopes)
    ) {
      if (
        node.arguments.length !== 2 ||
        !isNodeOfType(dependencies, "ArrayExpression") ||
        !dependencies.elements.some(
          (element) =>
            isNodeOfType(element, "Identifier") && scopes.symbolFor(element) === dispatcher.phase,
        ) ||
        !dependencies.elements.every((element) => {
          if (!isNodeOfType(element, "Identifier")) return false;
          const symbol = scopes.symbolFor(element);
          return Boolean(
            symbol &&
            !hasSymbolBindingWrites(symbol) &&
            (symbol === dispatcher.phase ||
              (symbol.kind === "parameter" &&
                findEnclosingFunction(symbol.bindingIdentifier) === owner)),
          );
        })
      ) {
        effectsSupported = false;
        return;
      }
      const clearStatements = isNodeOfType(statements[1].consequent, "BlockStatement")
        ? statements[1].consequent.body
        : [statements[1].consequent];
      if (
        clearStatements.length !== 2 ||
        !clearStatements[0] ||
        !clearStatements[1] ||
        !isClear(clearStatements[0], ticket, scopes) ||
        !literalAssignment(clearStatements[1], ticket, null, scopes)
      ) {
        effectsSupported = false;
        return;
      }
      if (isNodeOfType(clearStatements[0], "ExpressionStatement"))
        admittedClears.add(stripParenExpression(clearStatements[0].expression));
      referencesIn([statements[1]], ticket, scopes, ticketReferences);
      referencesIn([statements[2]], busy, scopes, busyReferences);
    }
    const returned =
      isNodeOfType(effect.body, "BlockStatement") &&
      statements.length === 1 &&
      isNodeOfType(statements[0], "ReturnStatement")
        ? statements[0].argument
        : effect.body;
    if (
      !isFunctionLike(returned) ||
      returned.async ||
      returned.generator ||
      returned.params.length !== 0
    )
      return;
    if (
      node.arguments.length !== 2 ||
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length !== 0
    )
      return;
    const cleanup = getCallbackStatements(returned);
    if (cleanup.length !== 1 || !cleanup[0] || !isNullGuard(cleanup[0], ticket, scopes)) return;
    const clear =
      isNodeOfType(cleanup[0].consequent, "BlockStatement") &&
      cleanup[0].consequent.body.length === 1
        ? cleanup[0].consequent.body[0]
        : cleanup[0].consequent;
    if (clear && isClear(clear, ticket, scopes)) {
      if (isNodeOfType(clear, "ExpressionStatement"))
        admittedClears.add(stripParenExpression(clear.expression));
      referencesIn(cleanup, ticket, scopes, ticketReferences);
    }
  });
  walkAst(scopes.rootScope.node, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      [...TIMER_CLEANUP_CALLEE_NAMES].some((name) =>
        isGlobalBrowserFunctionCall(node, name, scopes),
      ) &&
      !admittedClears.has(node)
    )
      effectsSupported = false;
  });
  if (
    !effectsSupported ||
    !hasOnlyAllowedSymbolReads({
      symbol: busy,
      allowedIdentifiers: busyReferences,
      program: scopes.rootScope.node,
      scopes,
    }) ||
    !hasOnlyAllowedSymbolReads({
      symbol: ticket,
      allowedIdentifiers: ticketReferences,
      program: scopes.rootScope.node,
      scopes,
    })
  )
    return null;
  return { closingState, callbackSymbol: callback.symbol };
};
