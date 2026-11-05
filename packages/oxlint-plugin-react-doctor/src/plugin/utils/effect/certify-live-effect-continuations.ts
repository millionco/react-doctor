import * as path from "node:path";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../build-source-project-index.js";
import type { SourceProjectIndex } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findEnclosingFunction } from "../find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getSingleReturnExpression } from "../get-single-return-expression.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { getValuePositionChildKeys } from "../get-value-position-child-keys.js";
import { isAstDescendant } from "../is-ast-descendant.js";
import { isAstNode } from "../is-ast-node.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isReactHookResultReference } from "../is-react-hook-result-reference.js";
import { normalizeFilename } from "../normalize-filename.js";
import { findNearestPackageDirectory } from "../read-nearest-package-manifest.js";
import { resolveExactLocalFunction } from "../resolve-exact-local-function.js";
import { resolveReactUseStatePair } from "../resolve-react-use-state-pair.js";
import type { RuleContext } from "../rule-context.js";
import { serializeReferenceKey } from "../serialize-reference-key.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import { walkOwnFunctionScope } from "../walk-own-function-scope.js";
import { certifyImperativeStateCall } from "./certify-imperative-state-call.js";
import { certifyDirectStateArgument } from "./certify-direct-state-argument.js";
import {
  certifyNativeSignalDelay,
  hasClosedNativeDelayGlobals,
  type NativeDelayGlobalCache,
} from "./certify-native-signal-delay.js";
import {
  certifyOwnedNativeDomOperation,
  certifyOwnedNativeDomMutation,
  isOwnedNativeEventDispatch,
  isOwnedNativeCollection,
  isOwnedNativePrimitive,
  isClosedReactRefRead,
} from "./certify-owned-native-dom-operation.js";
import { hasModernSourceSchedulingRole } from "./has-modern-source-scheduling-role.js";
import { isClosedReactHookCall } from "./is-closed-react-hook-call.js";
import {
  MAX_CONTINUATION_CERTIFICATE_DEPTH,
  MAX_CONTINUATION_CERTIFICATE_STATES,
  MAX_CONTINUATION_CERTIFICATE_STEPS,
  MAX_CONTINUATION_LOOP_PASSES,
} from "./continuation-certificate/constants.js";

interface ContinuationValue {
  primitive: boolean;
  isBoolean: boolean;
  truth: boolean | null;
  signal: EsTreeNode | null;
}

interface ContinuationState {
  suspended: boolean;
  asyncStarted: boolean;
  live: boolean;
  completion: "normal" | "return" | "throw" | "break" | "continue";
  value: ContinuationValue;
  bindings: Map<number, ContinuationValue>;
}

interface ContinuationCertificate {
  context: RuleContext;
  project: SourceProjectIndex;
  certifyDelay: (call: EsTreeNodeOfType<"CallExpression">, signal: EsTreeNode) => boolean;
  effect: EsTreeNode;
  cleanupReturn: EsTreeNode;
  signals: Map<string, EsTreeNode>;
  activeFunctions: Set<EsTreeNode>;
  steps: number;
  failed: boolean;
  sawBarrier: boolean;
  sawWrite: boolean;
}

interface OwnedEffectResources {
  signals: Map<string, EsTreeNode>;
  prefixGuardTests: ReadonlyArray<EsTreeNode>;
}

const DISPATCHER_HOOK_NAMES = new Set(["useState", "useReducer"]);
const UNKNOWN_VALUE: ContinuationValue = {
  primitive: false,
  isBoolean: false,
  truth: null,
  signal: null,
};
const primitiveValue = (truth: boolean | null = null, isBoolean = false): ContinuationValue => ({
  primitive: true,
  isBoolean,
  truth,
  signal: null,
});
const withValue = (state: ContinuationState, value: ContinuationValue): ContinuationState => ({
  ...state,
  value,
});

const referenceKey = (node: EsTreeNode, certificate: ContinuationCertificate): string | null =>
  serializeReferenceKey({ node, scopes: certificate.context.scopes });

const getReadonlySymbol = (
  node: EsTreeNode,
  certificate: ContinuationCertificate,
): SymbolDescriptor | null => {
  const symbol = certificate.context.scopes.symbolFor(node);
  return symbol && symbol.references.every((reference) => reference.flag === "read")
    ? symbol
    : null;
};

const isClosedStateDispatcherReference = (
  identifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const pair = resolveReactUseStatePair(identifier, context.scopes);
  if (
    !pair ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !isClosedReactHookCall(pair.declarator.init, "useState", context.scopes)
  )
    return false;
  const visited = new Set<SymbolDescriptor>();
  const hasClosedReferences = (symbol: SymbolDescriptor): boolean => {
    if (visited.has(symbol)) return false;
    visited.add(symbol);
    return symbol.references.every((reference) => {
      if (reference.flag !== "read") return false;
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (isNodeOfType(parent, "CallExpression") && parent.callee === root) return true;
      if (
        !isNodeOfType(parent, "VariableDeclarator") ||
        parent.init !== root ||
        !isNodeOfType(parent.id, "Identifier")
      )
        return false;
      const alias = context.scopes.symbolFor(parent.id);
      return Boolean(alias && alias.kind === "const" && hasClosedReferences(alias));
    });
  };
  return hasClosedReferences(pair.setterSymbol);
};

const resolveClosedLocalFunction = (
  expression: EsTreeNode,
  context: RuleContext,
  visited = new Set<number>(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isFunctionLike(candidate)) return candidate;
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(candidate);
  if (
    !symbol ||
    visited.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return null;
  visited.add(symbol.id);
  if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode))
    return symbol.declarationNode;
  return symbol.kind === "const" && symbol.initializer
    ? resolveClosedLocalFunction(symbol.initializer, context, visited)
    : null;
};

const resolveSignal = (
  node: EsTreeNode,
  state: ContinuationState,
  certificate: ContinuationCertificate,
  visited = new Set<number>(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(node);
  const key = referenceKey(candidate, certificate);
  if (key && certificate.signals.has(key)) return certificate.signals.get(key) ?? null;
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = getReadonlySymbol(candidate, certificate);
  if (!symbol || visited.has(symbol.id)) return null;
  const boundSignal = state.bindings.get(symbol.id)?.signal;
  if (boundSignal) return boundSignal;
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  visited.add(symbol.id);
  return resolveSignal(symbol.initializer, state, certificate, visited);
};

const getSignalDestructureBinding = (
  declaration: EsTreeNodeOfType<"VariableDeclarator">,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    declaration.id.properties.length !== 1
  )
    return null;
  const property = declaration.id.properties[0];
  return property &&
    isNodeOfType(property, "Property") &&
    property.kind === "init" &&
    !property.computed &&
    !property.method &&
    isNodeOfType(property.key, "Identifier") &&
    property.key.name === "signal" &&
    isNodeOfType(property.value, "Identifier")
    ? property.value
    : null;
};

const collectOwnedEffectResources = (
  effect: EsTreeNode,
  context: RuleContext,
  resolveProject: () => SourceProjectIndex | null,
  certifyDelay: ContinuationCertificate["certifyDelay"],
): OwnedEffectResources | null => {
  const signals = new Map<string, EsTreeNode>();
  if (!isFunctionLike(effect) || !isNodeOfType(effect.body, "BlockStatement")) return null;
  const statements = effect.body.body;
  const cleanupReturn = statements.at(-1);
  if (!isNodeOfType(cleanupReturn, "ReturnStatement") || !cleanupReturn.argument) return null;
  const cleanup = stripParenExpression(cleanupReturn.argument);
  if (!isFunctionLike(cleanup) || cleanup.async || cleanup.generator || cleanup.params.length > 0) {
    return null;
  }
  const returnedCleanup = getSingleReturnExpression(cleanup);
  const cleanupCandidate =
    returnedCleanup ??
    (isNodeOfType(cleanup.body, "BlockStatement") &&
    cleanup.body.body.length === 1 &&
    isNodeOfType(cleanup.body.body[0], "ExpressionStatement")
      ? cleanup.body.body[0].expression
      : null);
  const cleanupExpression = cleanupCandidate && stripParenExpression(cleanupCandidate);
  if (
    !isNodeOfType(cleanupExpression, "CallExpression") ||
    cleanupExpression.arguments.length > 0
  ) {
    return null;
  }
  const abortMember = stripParenExpression(cleanupExpression.callee);
  if (
    !isNodeOfType(abortMember, "MemberExpression") ||
    getStaticPropertyName(abortMember) !== "abort"
  ) {
    return null;
  }
  const controller = stripParenExpression(abortMember.object);
  if (!isNodeOfType(controller, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(controller);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !isNodeOfType(initializer, "NewExpression") ||
    initializer.arguments.length !== 0 ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    initializer.callee.name !== "AbortController" ||
    !context.scopes.isGlobalReference(initializer.callee) ||
    findEnclosingFunction(symbol.declarationNode) !== effect ||
    !isNodeOfType(symbol.declarationNode.parent, "VariableDeclaration") ||
    symbol.declarationNode.parent.parent !== effect.body
  )
    return null;
  const controllerStatement = symbol.declarationNode.parent;
  const controllerStatementIndex = statements.findIndex(
    (statement) => statement === controllerStatement,
  );
  if (controllerStatementIndex < 0) return null;
  const prefixGuardTests: EsTreeNode[] = [];
  const prefixReturns = new Set<EsTreeNode>();
  for (const statement of statements) {
    if (statement === controllerStatement) break;
    if (!isNodeOfType(statement, "IfStatement") || statement.alternate) break;
    const consequent = isNodeOfType(statement.consequent, "BlockStatement")
      ? statement.consequent.body.length === 1
        ? statement.consequent.body[0]
        : null
      : statement.consequent;
    if (!isNodeOfType(consequent, "ReturnStatement") || consequent.argument) break;
    prefixReturns.add(consequent);
    prefixGuardTests.push(statement.test);
  }
  let hasUnprovedEffectExit = false;
  walkOwnFunctionScope(effect, (candidate) => {
    if (
      (isNodeOfType(candidate, "ReturnStatement") &&
        candidate !== cleanupReturn &&
        !prefixReturns.has(candidate)) ||
      isNodeOfType(candidate, "ThrowStatement")
    )
      hasUnprovedEffectExit = true;
  });
  if (hasUnprovedEffectExit) return null;
  const activeSignalSymbols = new Set<number>();
  const signalResultsBySymbolAndDepth = new Map<number, Map<number, boolean>>();
  const hasClosedSignalReferences = (signalSymbol: SymbolDescriptor, depth: number): boolean => {
    if (depth >= MAX_CONTINUATION_CERTIFICATE_DEPTH || activeSignalSymbols.has(signalSymbol.id))
      return false;
    const previous = signalResultsBySymbolAndDepth.get(signalSymbol.id)?.get(depth);
    if (previous !== undefined) return previous;
    activeSignalSymbols.add(signalSymbol.id);
    let isClosed = false;
    try {
      isClosed = signalSymbol.references.every(
        (reference) =>
          reference.flag === "read" && hasClosedSignalUses(reference.identifier, depth + 1),
      );
    } finally {
      activeSignalSymbols.delete(signalSymbol.id);
    }
    let resultsByDepth = signalResultsBySymbolAndDepth.get(signalSymbol.id);
    if (!resultsByDepth) {
      resultsByDepth = new Map();
      signalResultsBySymbolAndDepth.set(signalSymbol.id, resultsByDepth);
    }
    resultsByDepth.set(depth, isClosed);
    return isClosed;
  };
  const hasClosedSignalUses = (signalReference: EsTreeNode, depth = 0): boolean => {
    if (depth >= MAX_CONTINUATION_CERTIFICATE_DEPTH) return false;
    const signalRoot = findTransparentExpressionRoot(signalReference);
    const parent = signalRoot.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === signalRoot &&
      getStaticPropertyName(parent) === "aborted"
    ) {
      const memberRoot = findTransparentExpressionRoot(parent);
      const owner = memberRoot.parent;
      return !(
        (isNodeOfType(owner, "AssignmentExpression") && owner.left === memberRoot) ||
        (isNodeOfType(owner, "UpdateExpression") && owner.argument === memberRoot) ||
        (isNodeOfType(owner, "UnaryExpression") && owner.operator === "delete")
      );
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === signalRoot &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const alias = context.scopes.symbolFor(parent.id);
      if (!alias || alias.kind !== "const") return false;
      return hasClosedSignalReferences(alias, depth);
    }
    if (!isNodeOfType(parent, "CallExpression")) return false;
    const project = resolveProject();
    if (!project) return false;
    if (certifyDelay(parent, signalReference)) return true;
    const localFunction = resolveClosedLocalFunction(parent.callee, context);
    const parameterIndex = parent.arguments.findIndex((argument) => argument === signalRoot);
    if (!isFunctionLike(localFunction) || parameterIndex < 0) return false;
    const parameter = localFunction.params[parameterIndex];
    if (!isNodeOfType(parameter, "Identifier")) return false;
    const parameterSymbol = context.scopes.symbolFor(parameter);
    return Boolean(parameterSymbol && hasClosedSignalReferences(parameterSymbol, depth));
  };
  for (const reference of symbol.references) {
    const controllerRoot = findTransparentExpressionRoot(reference.identifier);
    const member = controllerRoot.parent;
    if (reference.flag !== "read") return null;
    if (isNodeOfType(member, "VariableDeclarator") && member.init === controllerRoot) {
      const binding = getSignalDestructureBinding(member);
      const alias = binding && context.scopes.symbolFor(binding);
      if (
        !binding ||
        !alias ||
        alias.kind !== "const" ||
        !isNodeOfType(member.parent, "VariableDeclaration") ||
        member.parent.parent !== effect.body ||
        statements.findIndex((statement) => statement === member.parent) <= controllerStatementIndex
      )
        return null;
      activeSignalSymbols.clear();
      signalResultsBySymbolAndDepth.clear();
      if (
        !alias.references.every((aliasReference) => {
          const property = aliasReference.identifier.parent;
          // HACK: Scope analysis records shorthand pattern keys as reads; this key only names the binding.
          const isBindingKey =
            isNodeOfType(property, "Property") &&
            property.shorthand &&
            property.key === aliasReference.identifier &&
            property.value === binding &&
            property.parent === member.id;
          return (
            isBindingKey ||
            (aliasReference.flag === "read" && hasClosedSignalUses(aliasReference.identifier))
          );
        })
      )
        return null;
      const key = serializeReferenceKey({ node: binding, scopes: context.scopes });
      if (!key) return null;
      signals.set(key, binding);
      continue;
    }
    if (!isNodeOfType(member, "MemberExpression") || member.object !== controllerRoot) return null;
    if (member === abortMember) continue;
    if (getStaticPropertyName(member) !== "signal") return null;
    activeSignalSymbols.clear();
    signalResultsBySymbolAndDepth.clear();
    if (!hasClosedSignalUses(member)) return null;
    const key = serializeReferenceKey({ node: member, scopes: context.scopes });
    if (key) signals.set(key, member);
  }
  let mutatesNativeCancellation = false;
  const program = context.scopes.rootScope.node;
  if (program)
    walkAst(program, (candidate) => {
      if (
        !isNodeOfType(candidate, "Identifier") ||
        !["AbortController", "AbortSignal"].includes(candidate.name)
      )
        return;
      if (!context.scopes.isGlobalReference(candidate)) return;
      const parent = candidate.parent;
      if (isNodeOfType(parent, "NewExpression") && parent.callee === candidate) return;
      mutatesNativeCancellation = true;
    });
  return mutatesNativeCancellation ? null : { signals, prefixGuardTests };
};

const isClosedPrefixGuardExpression = (
  expression: EsTreeNode,
  certificate: ContinuationCertificate,
  depth = 0,
): boolean => {
  if (depth >= MAX_CONTINUATION_CERTIFICATE_DEPTH || !spendStep(certificate)) return false;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return true;
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = certificate.context.scopes.symbolFor(candidate);
    return Boolean(symbol && symbol.references.every((reference) => reference.flag === "read"));
  }
  if (isNodeOfType(candidate, "MemberExpression"))
    return (
      !candidate.optional &&
      isClosedReactRefRead(candidate, certificate.context, certificate.project)
    );
  if (isNodeOfType(candidate, "UnaryExpression"))
    return (
      candidate.operator === "!" &&
      isClosedPrefixGuardExpression(candidate.argument, certificate, depth + 1)
    );
  return (
    isNodeOfType(candidate, "LogicalExpression") &&
    ["&&", "||"].includes(candidate.operator) &&
    isClosedPrefixGuardExpression(candidate.left, certificate, depth + 1) &&
    isClosedPrefixGuardExpression(candidate.right, certificate, depth + 1)
  );
};

const boundedStates = (
  states: ContinuationState[],
  certificate: ContinuationCertificate,
): ContinuationState[] => {
  const uniqueStates = new Map<string, ContinuationState>();
  for (const state of states) {
    const bindings = [...state.bindings].map(([identifier, value]) => [
      identifier,
      value.primitive,
      value.isBoolean,
      value.truth,
      value.signal?.range[0] ?? null,
    ]);
    const key = JSON.stringify([
      state.suspended,
      state.asyncStarted,
      state.live,
      state.completion,
      state.value.primitive,
      state.value.isBoolean,
      state.value.truth,
      state.value.signal?.range[0] ?? null,
      bindings,
    ]);
    uniqueStates.set(key, state);
  }
  if (uniqueStates.size > MAX_CONTINUATION_CERTIFICATE_STATES) {
    certificate.failed = true;
    return [];
  }
  return [...uniqueStates.values()];
};

const spendStep = (certificate: ContinuationCertificate): boolean => {
  certificate.steps += 1;
  if (certificate.steps <= MAX_CONTINUATION_CERTIFICATE_STEPS) return true;
  certificate.failed = true;
  return false;
};

const evaluateList = (
  expressions: ReadonlyArray<EsTreeNode | null>,
  initialStates: ContinuationState[],
  certificate: ContinuationCertificate,
): ContinuationState[] => {
  let states = initialStates;
  for (const expression of expressions) {
    if (expression) states = evaluateExpression(expression, states, certificate);
  }
  return states;
};

const evaluateUnknownExpression = (
  expression: EsTreeNode,
  states: ContinuationState[],
  certificate: ContinuationCertificate,
): ContinuationState[] => {
  if (certificate.activeFunctions.size === 1 && states.some((state) => state.asyncStarted)) {
    certificate.failed = true;
    return [];
  }
  const children: EsTreeNode[] = [];
  for (const childKey of getValuePositionChildKeys(expression)) {
    const child = Reflect.get(expression, childKey);
    if (Array.isArray(child)) {
      for (const element of child) if (isAstNode(element)) children.push(element);
    } else if (isAstNode(child)) children.push(child);
  }
  return evaluateList(children, states, certificate).map((state) => ({
    ...state,
    live: false,
    value: UNKNOWN_VALUE,
  }));
};

const splitCondition = (
  expression: EsTreeNode,
  initialStates: ContinuationState[],
  certificate: ContinuationCertificate,
): { consequent: ContinuationState[]; alternate: ContinuationState[] } => {
  const consequent: ContinuationState[] = [];
  const alternate: ContinuationState[] = [];
  for (const state of evaluateExpression(expression, initialStates, certificate)) {
    if (state.value.truth !== false) consequent.push(state);
    if (state.value.truth !== true) alternate.push(state);
  }
  return { consequent, alternate };
};

const evaluateLocalCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  functionNode: EsTreeNode,
  states: ContinuationState[],
  certificate: ContinuationCertificate,
  awaited: boolean,
): ContinuationState[] => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.generator ||
    certificate.activeFunctions.has(functionNode) ||
    certificate.activeFunctions.size >= MAX_CONTINUATION_CERTIFICATE_DEPTH ||
    call.arguments.length > functionNode.params.length
  ) {
    certificate.failed = true;
    return [];
  }
  if (
    !functionNode.async &&
    certificate.activeFunctions.size === 1 &&
    states.some((state) => state.asyncStarted)
  ) {
    certificate.failed = true;
    return [];
  }
  const argumentStates: ContinuationState[] = [];
  for (const initialState of states) {
    let boundStates = [{ ...initialState, bindings: new Map(initialState.bindings) }];
    for (let index = 0; index < functionNode.params.length; index += 1) {
      const parameter = functionNode.params[index];
      const argument = call.arguments[index];
      if (!isNodeOfType(parameter, "Identifier") || isNodeOfType(argument, "SpreadElement")) {
        certificate.failed = true;
        return [];
      }
      const symbol = certificate.context.scopes.symbolFor(parameter);
      if (!symbol) {
        certificate.failed = true;
        return [];
      }
      boundStates = argument
        ? evaluateExpression(argument, boundStates, certificate)
        : boundStates.map((state) => withValue(state, primitiveValue(false)));
      boundStates = boundStates.map((state) => {
        const bindings = new Map(state.bindings);
        bindings.set(symbol.id, state.value);
        return { ...state, bindings };
      });
    }
    argumentStates.push(...boundStates);
  }
  if (functionNode.async && !awaited && certificate.activeFunctions.size > 1) {
    certificate.failed = true;
    return [];
  }
  certificate.activeFunctions.add(functionNode);
  const results = isNodeOfType(functionNode.body, "BlockStatement")
    ? evaluateStatements(functionNode.body.body, argumentStates, certificate)
    : evaluateExpression(functionNode.body, argumentStates, certificate).map(
        (state): ContinuationState => ({ ...state, completion: "return" }),
      );
  certificate.activeFunctions.delete(functionNode);
  if (functionNode.async && !awaited) {
    return states.map((state) => ({
      ...state,
      asyncStarted: true,
      live: false,
      value: UNKNOWN_VALUE,
    }));
  }
  return results.map((state) => ({
    ...state,
    completion: state.completion === "throw" ? "throw" : "normal",
    suspended: state.suspended || awaited,
    live: awaited ? false : state.live,
    value: awaited && !state.value.primitive ? UNKNOWN_VALUE : state.value,
  }));
};

const evaluateCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  states: ContinuationState[],
  certificate: ContinuationCertificate,
  awaited = false,
): ContinuationState[] => {
  const context = certificate.context;
  const inspectedArgumentFunctions = new Set<EsTreeNode>();
  const inspectArgument = (argument: EsTreeNode): void => {
    if (!spendStep(certificate)) return;
    walkAst(argument, (candidate) => {
      if (
        isNodeOfType(candidate, "Identifier") &&
        isReactHookResultReference(candidate, DISPATCHER_HOOK_NAMES, 1, context.scopes)
      ) {
        certificate.failed = true;
      }
      if (isNodeOfType(candidate, "Identifier")) {
        const argumentFunction = resolveClosedLocalFunction(candidate, context);
        if (argumentFunction && !inspectedArgumentFunctions.has(argumentFunction)) {
          inspectedArgumentFunctions.add(argumentFunction);
          inspectArgument(argumentFunction);
        }
      }
      if (
        isFunctionLike(argument) &&
        isNodeOfType(candidate, "MemberExpression") &&
        getStaticPropertyName(candidate) === "current"
      ) {
        certificate.failed = true;
      }
    });
  };
  for (const argument of call.arguments) {
    inspectArgument(argument);
  }
  if (certificate.failed) return [];
  const localFunction = resolveClosedLocalFunction(call.callee, context);
  if (localFunction) return evaluateLocalCall(call, localFunction, states, certificate, awaited);
  if (resolveExactLocalFunction(call.callee, context.scopes)) {
    certificate.failed = true;
    return [];
  }
  const callee = stripParenExpression(call.callee);
  const isDispatcher =
    isNodeOfType(callee, "Identifier") &&
    isReactHookResultReference(callee, DISPATCHER_HOOK_NAMES, 1, context.scopes);
  if (isDispatcher && !isClosedStateDispatcherReference(callee, context)) {
    certificate.failed = true;
    return [];
  }
  const isImperativeWrite = certifyImperativeStateCall(
    call,
    context,
    certificate.project,
    (argument) => isOwnedNativePrimitive(argument, context, certificate.project),
  );
  if (isDispatcher || isImperativeWrite) {
    certificate.sawWrite = true;
    if (isDispatcher && call.arguments.length !== 1) certificate.failed = true;
    const isCertifiedStateArgument =
      isDispatcher &&
      certifyDirectStateArgument({
        call,
        context,
        project: certificate.project,
      });
    const evaluatedStates =
      isImperativeWrite || isCertifiedStateArgument
        ? states
        : evaluateList(call.arguments, states, certificate);
    for (const state of evaluatedStates) {
      if (
        (state.suspended && !state.live) ||
        (!isImperativeWrite && !isCertifiedStateArgument && !state.value.primitive)
      )
        certificate.failed = true;
    }
    return evaluatedStates.map((state) => withValue(state, primitiveValue(false)));
  }
  if (certificate.activeFunctions.size === 1 && states.some((state) => state.asyncStarted)) {
    certificate.failed = true;
    return [];
  }
  if (certifyOwnedNativeDomOperation(call, context, certificate.project)) {
    return states.map((state) => withValue(state, UNKNOWN_VALUE));
  }
  if (isOwnedNativeEventDispatch(call, context, certificate.project)) {
    return evaluateList(call.arguments, states, certificate).map((state) => ({
      ...state,
      live: false,
      value: UNKNOWN_VALUE,
      suspended: state.suspended || awaited,
    }));
  }
  if (isNodeOfType(callee, "MemberExpression")) {
    const receiver = stripParenExpression(callee.object);
    if (
      isNodeOfType(receiver, "MemberExpression") &&
      getStaticPropertyName(receiver) === "current" &&
      states.some((state) => state.suspended)
    ) {
      certificate.failed = true;
      return [];
    }
  }
  const evaluated = evaluateList(
    call.arguments,
    evaluateExpression(call.callee, states, certificate),
    certificate,
  );
  return evaluated.map((state) => ({
    ...state,
    live: false,
    value: UNKNOWN_VALUE,
    suspended: state.suspended || awaited,
  }));
};

const evaluateExpression = (
  expression: EsTreeNode,
  initialStates: ContinuationState[],
  certificate: ContinuationCertificate,
): ContinuationState[] => {
  if (!spendStep(certificate) || certificate.failed) return [];
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    return initialStates.map((state) =>
      withValue(
        state,
        candidate.value !== null && typeof candidate.value === "object"
          ? UNKNOWN_VALUE
          : primitiveValue(Boolean(candidate.value), typeof candidate.value === "boolean"),
      ),
    );
  }
  if (isFunctionLike(candidate))
    return initialStates.map((state) => withValue(state, UNKNOWN_VALUE));
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = getReadonlySymbol(candidate, certificate);
    return initialStates.flatMap((state) => {
      const signal = resolveSignal(candidate, state, certificate);
      if (signal)
        return [withValue(state, { primitive: false, isBoolean: false, truth: null, signal })];
      const bound = symbol && state.bindings.get(symbol.id);
      if (bound) return [withValue(state, bound)];
      if (
        symbol?.kind === "const" &&
        symbol.initializer &&
        isAstDescendant(candidate, symbol.initializer) === false
      ) {
        if (isNodeOfType(stripParenExpression(symbol.initializer), "Literal"))
          return evaluateExpression(symbol.initializer, [state], certificate);
      }
      return [withValue(state, UNKNOWN_VALUE)];
    });
  }
  if (isNodeOfType(candidate, "AwaitExpression")) {
    const awaited = stripParenExpression(candidate.argument);
    if (isNodeOfType(awaited, "CallExpression")) {
      const results: ContinuationState[] = [];
      let allCertified = true;
      for (const state of initialStates) {
        const signal = awaited.arguments.find((argument) =>
          resolveSignal(argument, state, certificate),
        );
        if (!signal || !certificate.certifyDelay(awaited, signal)) {
          allCertified = false;
          break;
        }
        certificate.sawBarrier = true;
        results.push({ ...state, suspended: true, live: true, value: primitiveValue(true, true) });
        results.push({
          ...state,
          suspended: true,
          live: false,
          value: primitiveValue(false, true),
        });
      }
      if (allCertified) return boundedStates(results, certificate);
      return evaluateCall(awaited, initialStates, certificate, true).map((state) => ({
        ...state,
        suspended: true,
        live: false,
      }));
    }
    return evaluateExpression(awaited, initialStates, certificate).map((state) => ({
      ...state,
      suspended: true,
      live: false,
      value: UNKNOWN_VALUE,
    }));
  }
  if (isNodeOfType(candidate, "CallExpression"))
    return evaluateCall(candidate, initialStates, certificate);
  if (isNodeOfType(candidate, "MemberExpression")) {
    if (
      certificate.activeFunctions.size === 1 &&
      initialStates.some((state) => state.asyncStarted)
    ) {
      certificate.failed = true;
      return [];
    }
    const memberName = getStaticPropertyName(candidate);
    if (memberName === "aborted") {
      if (initialStates.some((state) => resolveSignal(candidate.object, state, certificate)))
        certificate.sawBarrier = true;
      return initialStates.flatMap((state) =>
        resolveSignal(candidate.object, state, certificate)
          ? [
              { ...state, live: false, value: primitiveValue(true, true) },
              { ...state, live: true, value: primitiveValue(false, true) },
            ]
          : evaluateUnknownExpression(candidate, [state], certificate),
      );
    }
    const values = initialStates.map((state) => {
      const signal = resolveSignal(candidate, state, certificate);
      if (signal)
        return withValue(state, { primitive: false, isBoolean: false, truth: null, signal });
      if (isOwnedNativePrimitive(candidate, certificate.context, certificate.project))
        return withValue(state, primitiveValue());
      return null;
    });
    if (values.every((state) => state !== null)) return values;
    return evaluateUnknownExpression(candidate, initialStates, certificate);
  }
  if (isNodeOfType(candidate, "UnaryExpression")) {
    const evaluated = evaluateExpression(candidate.argument, initialStates, certificate);
    return evaluated.map((state) =>
      candidate.operator === "!"
        ? withValue(
            state,
            primitiveValue(state.value.truth === null ? null : !state.value.truth, true),
          )
        : candidate.operator === "void"
          ? withValue(state, primitiveValue(false))
          : state.value.primitive && candidate.operator !== "delete"
            ? withValue(state, primitiveValue())
            : { ...state, live: false, value: UNKNOWN_VALUE },
    );
  }
  if (
    isNodeOfType(candidate, "ConditionalExpression") ||
    isNodeOfType(candidate, "LogicalExpression")
  ) {
    const condition = isNodeOfType(candidate, "ConditionalExpression")
      ? candidate.test
      : candidate.left;
    const branches = splitCondition(condition, initialStates, certificate);
    if (isNodeOfType(candidate, "ConditionalExpression"))
      return boundedStates(
        [
          ...evaluateExpression(candidate.consequent, branches.consequent, certificate),
          ...evaluateExpression(candidate.alternate, branches.alternate, certificate),
        ],
        certificate,
      );
    if (candidate.operator === "&&")
      return boundedStates(
        [
          ...evaluateExpression(candidate.right, branches.consequent, certificate),
          ...branches.alternate,
        ],
        certificate,
      );
    if (candidate.operator === "||")
      return boundedStates(
        [
          ...branches.consequent,
          ...evaluateExpression(candidate.right, branches.alternate, certificate),
        ],
        certificate,
      );
    const evaluatedLeft = [...branches.consequent, ...branches.alternate];
    return boundedStates(
      [...evaluatedLeft, ...evaluateExpression(candidate.right, evaluatedLeft, certificate)],
      certificate,
    );
  }
  if (isNodeOfType(candidate, "BinaryExpression")) {
    const results: ContinuationState[] = [];
    for (const leftState of evaluateExpression(candidate.left, initialStates, certificate)) {
      for (const rightState of evaluateExpression(candidate.right, [leftState], certificate)) {
        const primitive = leftState.value.primitive && rightState.value.primitive;
        const rightOperand = stripParenExpression(candidate.right);
        const comparedBoolean =
          isNodeOfType(rightOperand, "Literal") && typeof rightOperand.value === "boolean"
            ? rightOperand.value
            : null;
        const truth =
          comparedBoolean !== null &&
          ["===", "!=="].includes(candidate.operator) &&
          leftState.value.isBoolean &&
          leftState.value.truth !== null
            ? candidate.operator === "==="
              ? leftState.value.truth === comparedBoolean
              : leftState.value.truth !== comparedBoolean
            : null;
        results.push({
          ...rightState,
          live: primitive ? rightState.live : false,
          value: primitive
            ? primitiveValue(
                truth,
                ["===", "!==", "==", "!=", "<", ">", "<=", ">="].includes(candidate.operator),
              )
            : UNKNOWN_VALUE,
        });
      }
    }
    return boundedStates(results, certificate);
  }
  if (isNodeOfType(candidate, "SequenceExpression"))
    return evaluateList(candidate.expressions, initialStates, certificate);
  if (
    isNodeOfType(candidate, "AssignmentExpression") &&
    certifyOwnedNativeDomMutation(candidate, certificate.context, certificate.project)
  ) {
    return initialStates.map((state) => withValue(state, primitiveValue()));
  }
  if (
    isNodeOfType(candidate, "AssignmentExpression") &&
    isNodeOfType(candidate.left, "Identifier")
  ) {
    const symbol = certificate.context.scopes.symbolFor(candidate.left);
    return evaluateExpression(candidate.right, initialStates, certificate).map((state) => {
      const bindings = new Map(state.bindings);
      if (symbol) bindings.delete(symbol.id);
      return { ...state, bindings, live: false, value: UNKNOWN_VALUE };
    });
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    let states = initialStates;
    for (const interpolation of candidate.expressions) {
      states = evaluateExpression(interpolation, states, certificate).map((state) =>
        state.value.primitive ? state : { ...state, live: false },
      );
    }
    return states.map((state) => withValue(state, primitiveValue()));
  }
  if (
    isNodeOfType(candidate, "UpdateExpression") &&
    isNodeOfType(candidate.argument, "Identifier")
  ) {
    return initialStates.map((state) => ({ ...state, live: false, value: UNKNOWN_VALUE }));
  }
  return evaluateUnknownExpression(candidate, initialStates, certificate);
};

const evaluateLoop = (
  loop:
    | EsTreeNodeOfType<"ForStatement">
    | EsTreeNodeOfType<"WhileStatement">
    | EsTreeNodeOfType<"DoWhileStatement">
    | EsTreeNodeOfType<"ForOfStatement">
    | EsTreeNodeOfType<"ForInStatement">,
  initialStates: ContinuationState[],
  certificate: ContinuationCertificate,
): ContinuationState[] => {
  if (
    isNodeOfType(loop, "ForInStatement") ||
    (isNodeOfType(loop, "ForOfStatement") &&
      (loop.await ||
        !isNodeOfType(loop.left, "VariableDeclaration") ||
        loop.left.kind !== "const" ||
        loop.left.declarations.length !== 1 ||
        !isNodeOfType(loop.left.declarations[0]?.id, "Identifier") ||
        !isOwnedNativeCollection(loop.right, certificate.context, certificate.project)))
  ) {
    certificate.failed = true;
    return [];
  }
  let pending =
    isNodeOfType(loop, "ForStatement") && loop.init
      ? isNodeOfType(loop.init, "VariableDeclaration")
        ? evaluateStatements([loop.init], initialStates, certificate)
        : evaluateExpression(loop.init, initialStates, certificate)
      : initialStates;
  const exited: ContinuationState[] = [];
  const seen = new Set<string>();
  if (isNodeOfType(loop, "ForOfStatement")) exited.push(...pending);
  for (let pass = 0; pass < MAX_CONTINUATION_LOOP_PASSES; pass += 1) {
    const branches =
      isNodeOfType(loop, "DoWhileStatement") && pass === 0
        ? { consequent: pending, alternate: [] }
        : !isNodeOfType(loop, "ForOfStatement") && loop.test
          ? splitCondition(loop.test, pending, certificate)
          : { consequent: pending, alternate: [] };
    exited.push(...branches.alternate);
    const entered =
      isNodeOfType(loop, "DoWhileStatement") && pass === 0 ? pending : branches.consequent;
    const body = evaluateStatements(
      isNodeOfType(loop.body, "BlockStatement") ? loop.body.body : [loop.body],
      entered,
      certificate,
    );
    exited.push(
      ...body
        .filter((state) => state.completion === "break")
        .map((state): ContinuationState => ({ ...state, completion: "normal" })),
    );
    exited.push(
      ...body.filter((state) => state.completion === "return" || state.completion === "throw"),
    );
    pending = body
      .filter((state) => state.completion === "normal" || state.completion === "continue")
      .map((state): ContinuationState => ({ ...state, completion: "normal" }));
    if (isNodeOfType(loop, "ForStatement") && loop.update)
      pending = evaluateExpression(loop.update, pending, certificate);
    pending = boundedStates(pending, certificate);
    if (isNodeOfType(loop, "ForOfStatement")) exited.push(...pending);
    const key = JSON.stringify(
      pending.map((state) => [
        state.suspended,
        state.live,
        [...state.bindings].map(([identifier, value]) => [
          identifier,
          value.truth,
          value.primitive,
          value.isBoolean,
          value.signal?.range[0] ?? null,
        ]),
      ]),
    );
    if (pending.length === 0 || seen.has(key)) return boundedStates(exited, certificate);
    seen.add(key);
  }
  certificate.failed = true;
  return [];
};

const evaluateStatements = (
  statements: ReadonlyArray<EsTreeNode>,
  initialStates: ContinuationState[],
  certificate: ContinuationCertificate,
): ContinuationState[] => {
  let states = initialStates;
  for (const statement of statements) {
    if (!spendStep(certificate) || certificate.failed) return [];
    const completed = states.filter((state) => state.completion !== "normal");
    const active = states.filter((state) => state.completion === "normal");
    if (active.length === 0) break;
    if (
      certificate.activeFunctions.size === 1 &&
      active.some((state) => state.asyncStarted) &&
      statement !== certificate.cleanupReturn
    ) {
      certificate.failed = true;
      return [];
    }
    let nextStates: ContinuationState[];
    if (isNodeOfType(statement, "BlockStatement"))
      nextStates = evaluateStatements(statement.body, active, certificate);
    else if (isNodeOfType(statement, "ExpressionStatement"))
      nextStates = evaluateExpression(statement.expression, active, certificate);
    else if (isNodeOfType(statement, "VariableDeclaration")) {
      nextStates = active;
      for (const declaration of statement.declarations) {
        if (!isNodeOfType(declaration.id, "Identifier")) {
          const binding = getSignalDestructureBinding(declaration);
          const symbol = binding && certificate.context.scopes.symbolFor(binding);
          const key = binding && referenceKey(binding, certificate);
          const signal = key && certificate.signals.get(key);
          if (!symbol || !signal) {
            certificate.failed = true;
            return [];
          }
          nextStates = nextStates.map((state) => {
            const value = { primitive: false, isBoolean: false, truth: null, signal };
            const bindings = new Map(state.bindings);
            bindings.set(symbol.id, value);
            return { ...state, bindings, value };
          });
          continue;
        }
        const symbol = certificate.context.scopes.symbolFor(declaration.id);
        nextStates = declaration.init
          ? evaluateExpression(declaration.init, nextStates, certificate)
          : nextStates.map((state) => withValue(state, primitiveValue(false)));
        nextStates = nextStates.map((state) => {
          const bindings = new Map(state.bindings);
          if (symbol && statement.kind === "const") bindings.set(symbol.id, state.value);
          return { ...state, bindings };
        });
      }
    } else if (isNodeOfType(statement, "IfStatement")) {
      const branches = splitCondition(statement.test, active, certificate);
      nextStates = [
        ...evaluateStatements([statement.consequent], branches.consequent, certificate),
        ...(statement.alternate
          ? evaluateStatements([statement.alternate], branches.alternate, certificate)
          : branches.alternate),
      ];
    } else if (
      isNodeOfType(statement, "ReturnStatement") ||
      isNodeOfType(statement, "ThrowStatement")
    ) {
      nextStates = (
        statement.argument
          ? evaluateExpression(statement.argument, active, certificate)
          : active.map((state) => withValue(state, primitiveValue(false)))
      ).map((state) => ({
        ...state,
        completion: isNodeOfType(statement, "ReturnStatement") ? "return" : "throw",
      }));
    } else if (isNodeOfType(statement, "TryStatement")) {
      nextStates = evaluateStatements(statement.block.body, active, certificate);
      if (statement.handler)
        nextStates.push(
          ...evaluateStatements(
            statement.handler.body.body,
            active.map((state) => ({ ...state, suspended: true, live: false })),
            certificate,
          ),
        );
      if (statement.finalizer)
        nextStates = nextStates.flatMap((state) =>
          evaluateStatements(
            statement.finalizer?.body ?? [],
            [{ ...state, completion: "normal" }],
            certificate,
          ).map((finalized) => ({
            ...finalized,
            completion: finalized.completion === "normal" ? state.completion : finalized.completion,
            value: finalized.completion === "normal" ? state.value : finalized.value,
          })),
        );
    } else if (
      isNodeOfType(statement, "ForStatement") ||
      isNodeOfType(statement, "WhileStatement") ||
      isNodeOfType(statement, "DoWhileStatement") ||
      isNodeOfType(statement, "ForOfStatement") ||
      isNodeOfType(statement, "ForInStatement")
    ) {
      nextStates = evaluateLoop(statement, active, certificate);
    } else if (
      isNodeOfType(statement, "BreakStatement") ||
      isNodeOfType(statement, "ContinueStatement")
    ) {
      if (statement.label) {
        certificate.failed = true;
        return [];
      }
      nextStates = active.map((state) => ({
        ...state,
        completion: isNodeOfType(statement, "BreakStatement") ? "break" : "continue",
      }));
    } else if (
      isNodeOfType(statement, "FunctionDeclaration") ||
      isNodeOfType(statement, "EmptyStatement")
    )
      nextStates = active;
    else {
      certificate.failed = true;
      return [];
    }
    states = boundedStates([...completed, ...nextStates], certificate);
  }
  return states;
};

export const createLiveEffectContinuationCertifier = (context: RuleContext) => {
  let hasClosedGlobals: boolean | undefined;
  let globalCache: NativeDelayGlobalCache | undefined;
  let resolvedProject: SourceProjectIndex | null | undefined;
  const resolveProject = (): SourceProjectIndex | null => {
    if (resolvedProject !== undefined) return resolvedProject;
    const filename = context.filename;
    const program = context.scopes.rootScope.node;
    if (!filename || !path.isAbsolute(filename) || !isNodeOfType(program, "Program")) {
      resolvedProject = null;
      return null;
    }
    const rootDirectory = findNearestPackageDirectory(filename);
    resolvedProject = rootDirectory
      ? buildSourceProjectIndex({
          rootDirectory,
          currentFilePath: normalizeFilename(filename),
          currentProgramNode: program,
          currentScopes: context.scopes,
        })
      : null;
    if (resolvedProject && !hasModernSourceSchedulingRole(context, resolvedProject))
      resolvedProject = null;
    if (resolvedProject) globalCache = { project: resolvedProject, resultsByScope: new WeakMap() };
    return resolvedProject;
  };
  const certifyDelay: ContinuationCertificate["certifyDelay"] = (call, signal) => {
    const project = resolveProject();
    return Boolean(
      project && certifyNativeSignalDelay(call, signal, context, project, globalCache),
    );
  };
  return (effect: EsTreeNode, effectCall: EsTreeNodeOfType<"CallExpression">): boolean => {
    const filename = context.filename;
    if (
      !filename ||
      !path.isAbsolute(filename) ||
      !isFunctionLike(effect) ||
      !isNodeOfType(effect.body, "BlockStatement")
    )
      return false;
    if (
      ![...EFFECT_HOOK_NAMES].some((hookName) =>
        isClosedReactHookCall(effectCall, hookName, context.scopes),
      )
    )
      return false;
    const program = context.scopes.rootScope.node;
    if (!isNodeOfType(program, "Program")) return false;
    const resources = collectOwnedEffectResources(effect, context, resolveProject, certifyDelay);
    if (!resources || resources.signals.size === 0) return false;
    const project = resolveProject();
    if (!project) return false;
    hasClosedGlobals ??= [...project.modulesByFilePath.values()].every((module) =>
      hasClosedNativeDelayGlobals(module.scopes, project, globalCache),
    );
    if (!hasClosedGlobals) return false;
    const certificate: ContinuationCertificate = {
      context,
      project,
      certifyDelay,
      effect,
      cleanupReturn: effect.body.body.at(-1) ?? effect,
      signals: resources.signals,
      activeFunctions: new Set([effect]),
      steps: 0,
      failed: false,
      sawBarrier: false,
      sawWrite: false,
    };
    if (
      !resources.prefixGuardTests.every((test) => isClosedPrefixGuardExpression(test, certificate))
    )
      return false;
    const completions = evaluateStatements(
      effect.body.body,
      [
        {
          suspended: false,
          asyncStarted: false,
          live: false,
          completion: "normal",
          value: UNKNOWN_VALUE,
          bindings: new Map(),
        },
      ],
      certificate,
    );
    return (
      !certificate.failed &&
      certificate.sawBarrier &&
      certificate.sawWrite &&
      completions.every((state) => state.completion === "return")
    );
  };
};
