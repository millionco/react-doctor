import { createErasedDefaultExportCertificate } from "./create-erased-default-export-certificate.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex } from "../build-source-project-index.js";
import { collectConstAliasSymbols } from "../collect-const-alias-symbols.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getCallbackStatements } from "../get-callback-statements.js";
import { getDirectConstInitializer } from "../get-direct-const-initializer.js";
import { getSingleReturnExpression } from "../get-single-return-expression.js";
import { getResolvedStaticPropertyName } from "../get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { getStaticStringExpression } from "../get-static-string-expression.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isPassiveValueUse } from "../is-passive-value-use.js";
import { isProvenGlobalNamespaceReference } from "../is-proven-global-namespace-reference.js";
import { isProvenGlobalObjectReference } from "../is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "../resolve-const-identifier-alias.js";
import type { RuleContext } from "../rule-context.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import { createPrivatePrimitiveArrayReadCertificate } from "./create-private-primitive-array-read-certificate.js";
import { isSupportedNativeDelayWriter } from "./is-supported-native-delay-writer.js";
import { isSupportedRuntimeScopeNode } from "./is-supported-runtime-scope-node.js";
import { certifyReadonlySourcePrototypeUse } from "./certify-readonly-source-prototype-use.js";
import {
  NATIVE_DELAY_EXECUTOR_STATEMENT_COUNT,
  NATIVE_DELAY_GLOBAL_NAMES,
  NATIVE_DELAY_DYNAMIC_CODE_GLOBAL_NAMES,
  NATIVE_DELAY_UNOWNED_WINDOW_GLOBAL_NAMES,
  NATIVE_DELAY_GLOBAL_SELF_NAMES,
  NATIVE_DELAY_MAX_ABORT_STATEMENT_COUNT,
  NATIVE_DELAY_MAX_ALIAS_DEPTH,
  NATIVE_DELAY_MAX_ARGUMENT_COUNT,
  NATIVE_DELAY_MAX_PROGRAM_NODES,
  NATIVE_DELAY_SETTLEMENT_STATEMENT_COUNT,
  NATIVE_DELAY_SAFE_STATIC_METHODS,
  NATIVE_DELAY_PROTOTYPE_NAMES,
} from "./native-signal-delay/constants.js";

interface NativeDelayBindings {
  context: RuleContext;
  signal: SymbolDescriptor;
  resolver: SymbolDescriptor;
  timer: SymbolDescriptor;
  abort: SymbolDescriptor;
}

const isReadonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const sameBinding = (
  expression: EsTreeNode,
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const candidate = resolveConstIdentifierAlias(stripParenExpression(expression), context.scopes);
  return candidate === symbol && isReadonlySymbol(symbol);
};

const getStatementExpression = (statement: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(statement, "ExpressionStatement"))
    return stripParenExpression(statement.expression);
  if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
    return stripParenExpression(statement.argument);
  }
  return stripParenExpression(statement);
};

const getConstDeclaration = (
  statement: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
  if (statement.declarations.length !== 1) return null;
  const declaration = statement.declarations[0];
  return isNodeOfType(declaration.id, "Identifier") && declaration.init ? declaration : null;
};

const isPrimitiveDelayArgument = (
  rawExpression: EsTreeNode,
  context: RuleContext,
  depth = 0,
): boolean => {
  if (depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return false;
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) return typeof expression.value === "number";
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    const initializer =
      symbol && isReadonlySymbol(symbol) ? getDirectConstInitializer(symbol) : null;
    return Boolean(initializer && isPrimitiveDelayArgument(initializer, context, depth + 1));
  }
  if (isNodeOfType(expression, "UnaryExpression")) {
    return (
      (expression.operator === "+" || expression.operator === "-") &&
      isPrimitiveDelayArgument(expression.argument, context, depth + 1)
    );
  }
  return (
    isNodeOfType(expression, "BinaryExpression") &&
    isPrimitiveDelayArgument(expression.left, context, depth + 1) &&
    isPrimitiveDelayArgument(expression.right, context, depth + 1)
  );
};

const isNativeCall = (
  expression: EsTreeNode,
  name: string,
  context: RuleContext,
): expression is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  isProvenUnmodifiedGlobalNamespaceReference(expression.callee, name, context.scopes);

export interface NativeDelayGlobalCache {
  readonly project: SourceProjectIndex;
  readonly resultsByScope: WeakMap<ScopeAnalysis, boolean>;
}

export const hasClosedNativeDelayGlobals = (
  scopes: ScopeAnalysis,
  project?: SourceProjectIndex,
  globalCache?: NativeDelayGlobalCache,
): boolean => {
  const sourceModule =
    project && [...project.modulesByFilePath.values()].find((module) => module.scopes === scopes);
  if (project && !sourceModule) return false;
  const resultsByScope =
    project && globalCache?.project === project ? globalCache.resultsByScope : undefined;
  const cached = resultsByScope?.get(scopes);
  if (cached !== undefined) return cached;
  const isPrivatePrimitiveArrayRead = createPrivatePrimitiveArrayReadCertificate(scopes, project);
  const erasedDefaultReferences = sourceModule
    ? createErasedDefaultExportCertificate(sourceModule, project?.rootDirectory)
    : undefined;
  let isClosed = true;
  let visitedNodes = 0;
  walkAst(scopes.rootScope.node, (node) => {
    visitedNodes += 1;
    if (!isClosed || visitedNodes > NATIVE_DELAY_MAX_PROGRAM_NODES) {
      isClosed = false;
      return false;
    }
    if (
      !isSupportedRuntimeScopeNode(node, scopes, erasedDefaultReferences) ||
      !isSupportedNativeDelayWriter(node, scopes)
    ) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const propertyName = getResolvedStaticPropertyName(node, scopes);
      if (propertyName === "constructor" || (node.computed && propertyName === null)) {
        isClosed = false;
        return false;
      }
    }
    if (node.type !== "Identifier" && node.type !== "MemberExpression") return;
    if (isNodeOfType(node, "MemberExpression")) {
      const memberName = getResolvedStaticPropertyName(node, scopes, {
        allowConstTemplateLiteral: true,
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals:
          isNodeOfType(node.property, "Literal") && typeof node.property.value === "number",
      });
      const memberRoot = findTransparentExpressionRoot(node);
      const consumer = memberRoot.parent;
      if (
        memberName === null &&
        !isWithinAssignmentTarget(node) &&
        !isPassiveValueUse({ node, scopes, maximumDepth: NATIVE_DELAY_MAX_ALIAS_DEPTH }) &&
        !isPrivatePrimitiveArrayRead(node)
      ) {
        isClosed = false;
        return false;
      }
      if (memberName === "constructor") {
        isClosed = false;
        return false;
      }
      if (
        memberName === "get" &&
        isProvenGlobalNamespaceReference(node.object, "Reflect", scopes)
      ) {
        if (!isNodeOfType(consumer, "CallExpression") || consumer.callee !== memberRoot) {
          isClosed = false;
          return false;
        }
        const key = consumer.arguments[1];
        const keySymbol = isNodeOfType(key, "Identifier")
          ? resolveConstIdentifierAlias(key, scopes)
          : null;
        const keyName =
          getStaticStringExpression(key) ?? getStaticStringExpression(keySymbol?.initializer);
        if (keyName === null || keyName === "constructor") {
          isClosed = false;
          return false;
        }
      }
      if (
        memberName === "defaultView" ||
        (NATIVE_DELAY_GLOBAL_NAMES.includes(memberName ?? "") &&
          ((isNodeOfType(consumer, "AssignmentExpression") && consumer.left === memberRoot) ||
            (isNodeOfType(consumer, "UpdateExpression") && consumer.argument === memberRoot) ||
            (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "delete")))
      ) {
        isClosed = false;
        return false;
      }
    }
    if (
      NATIVE_DELAY_DYNAMIC_CODE_GLOBAL_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      ) ||
      NATIVE_DELAY_UNOWNED_WINDOW_GLOBAL_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    ) {
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      NATIVE_DELAY_PROTOTYPE_NAMES.has(
        getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true }) ?? "",
      )
    ) {
      if (
        getStaticPropertyName(node) === "prototype" &&
        project &&
        sourceModule &&
        certifyReadonlySourcePrototypeUse(node, sourceModule, project)
      )
        return;
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      (getResolvedStaticPropertyName(node, scopes) === null ||
        getResolvedStaticPropertyName(node, scopes) === "getPrototypeOf" ||
        getResolvedStaticPropertyName(node, scopes) === "setPrototypeOf") &&
      (isProvenGlobalNamespaceReference(node.object, "Object", scopes) ||
        isProvenGlobalNamespaceReference(node.object, "Reflect", scopes))
    ) {
      isClosed = false;
      return false;
    }
    if (isProvenGlobalObjectReference(node, scopes)) {
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === root &&
        getStaticPropertyName(parent) !== null &&
        !NATIVE_DELAY_GLOBAL_SELF_NAMES.includes(getStaticPropertyName(parent) ?? "")
      ) {
        const memberRoot = findTransparentExpressionRoot(parent);
        const consumer = memberRoot.parent;
        if (
          !(isNodeOfType(consumer, "AssignmentExpression") && consumer.left === memberRoot) &&
          !(isNodeOfType(consumer, "UpdateExpression") && consumer.argument === memberRoot) &&
          !(isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "delete")
        )
          return;
      }
      isClosed = false;
      return false;
    }
    for (const name of NATIVE_DELAY_GLOBAL_NAMES) {
      if (!isProvenGlobalNamespaceReference(node, name, scopes)) continue;
      if (scopes.symbolFor(node)?.bindingIdentifier === node) continue;
      const reference = scopes.referenceFor(node);
      if (reference && reference.flag !== "read") {
        isClosed = false;
        return false;
      }
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === root &&
        !parent.optional &&
        NATIVE_DELAY_SAFE_STATIC_METHODS[name]?.has(getStaticPropertyName(parent) ?? "")
      ) {
        const memberRoot = findTransparentExpressionRoot(parent);
        const consumer = memberRoot.parent;
        if (
          isNodeOfType(consumer, "CallExpression") &&
          consumer.callee === memberRoot &&
          !consumer.optional
        )
          continue;
      }
      if (
        (isNodeOfType(parent, "NewExpression") &&
          parent.callee === root &&
          (name === "Promise" || name === "AbortController")) ||
        (isNodeOfType(parent, "CallExpression") &&
          parent.callee === root &&
          (name === "setTimeout" || name === "clearTimeout"))
      )
        continue;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const symbol = scopes.symbolFor(parent.id);
        if (
          symbol?.kind === "const" &&
          isReadonlySymbol(symbol) &&
          parent.parent?.parent?.type !== "ExportNamedDeclaration"
        )
          continue;
      }
      isClosed = false;
      return false;
    }
    return;
  });
  resultsByScope?.set(scopes, isClosed);
  return isClosed;
};

const hasPrivateProducerReferences = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  if (symbol.scope !== context.scopes.rootScope || !isReadonlySymbol(symbol)) return false;
  if (symbol.kind !== "const" && symbol.kind !== "function") return false;
  let declaration = symbol.declarationNode.parent;
  if (isNodeOfType(declaration, "VariableDeclaration")) declaration = declaration.parent;
  if (!isNodeOfType(declaration, "Program")) return false;
  return collectConstAliasSymbols(symbol, context.scopes).every((alias) => {
    let aliasParent = alias.declarationNode.parent;
    if (isNodeOfType(aliasParent, "VariableDeclaration")) aliasParent = aliasParent.parent;
    if (
      aliasParent?.type === "ExportNamedDeclaration" ||
      aliasParent?.type === "ExportDefaultDeclaration"
    )
      return false;
    return (
      isReadonlySymbol(alias) &&
      alias.references.every((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (isNodeOfType(parent, "CallExpression") && !parent.optional && parent.callee === root) {
          return true;
        }
        return (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier") &&
          context.scopes.symbolFor(parent.id)?.kind === "const"
        );
      })
    );
  });
};

const isResolverSettlement = (
  statement: EsTreeNode,
  value: boolean,
  bindings: NativeDelayBindings,
): boolean => {
  const expression = getStatementExpression(statement);
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 1
  ) {
    return false;
  }
  const argument = stripParenExpression(expression.arguments[0]);
  return (
    sameBinding(expression.callee, bindings.resolver, bindings.context) &&
    isNodeOfType(argument, "Literal") &&
    argument.value === value
  );
};

const isSignalListenerCall = (
  statement: EsTreeNode,
  method: string,
  bindings: NativeDelayBindings,
): boolean => {
  const expression = getStatementExpression(statement);
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  const callee = stripParenExpression(expression.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    getStaticPropertyName(callee) !== method ||
    !sameBinding(callee.object, bindings.signal, bindings.context)
  ) {
    return false;
  }
  const [event, listener, options] = expression.arguments;
  if (
    !event ||
    !listener ||
    expression.arguments.length < NATIVE_DELAY_MAX_ARGUMENT_COUNT ||
    !isNodeOfType(event, "Literal") ||
    event.value !== "abort" ||
    !sameBinding(listener, bindings.abort, bindings.context)
  )
    return false;
  if (!options) return expression.arguments.length === NATIVE_DELAY_MAX_ARGUMENT_COUNT;
  if (
    method !== "addEventListener" ||
    expression.arguments.length !== NATIVE_DELAY_MAX_ABORT_STATEMENT_COUNT ||
    !isNodeOfType(options, "ObjectExpression") ||
    options.properties.length !== 1
  )
    return false;
  const property = options.properties[0];
  return (
    isNodeOfType(property, "Property") &&
    property.kind === "init" &&
    !property.method &&
    !property.computed &&
    ((isNodeOfType(property.key, "Identifier") && property.key.name === "once") ||
      (isNodeOfType(property.key, "Literal") && property.key.value === "once")) &&
    isNodeOfType(property.value, "Literal") &&
    property.value.value === true
  );
};

const isClosedSettlementCallback = (
  callback: EsTreeNode,
  successful: boolean,
  bindings: NativeDelayBindings,
): boolean => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 0
  )
    return false;
  const statements = getCallbackStatements(callback);
  const settlement = statements.at(-1);
  if (!settlement || !isResolverSettlement(settlement, successful, bindings)) return false;
  if (successful) {
    return (
      statements.length === NATIVE_DELAY_SETTLEMENT_STATEMENT_COUNT &&
      isSignalListenerCall(statements[0], "removeEventListener", bindings)
    );
  }
  const clearTimer = getStatementExpression(statements[0]);
  if (
    !clearTimer ||
    !isNativeCall(clearTimer, "clearTimeout", bindings.context) ||
    clearTimer.arguments.length !== 1 ||
    !sameBinding(clearTimer.arguments[0], bindings.timer, bindings.context)
  )
    return false;
  return (
    statements.length === NATIVE_DELAY_SETTLEMENT_STATEMENT_COUNT ||
    (statements.length === NATIVE_DELAY_MAX_ABORT_STATEMENT_COUNT &&
      isSignalListenerCall(statements[1], "removeEventListener", bindings))
  );
};

const isAbortedEarlyExit = (statement: EsTreeNode, bindings: NativeDelayBindings): boolean => {
  if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
  const test = stripParenExpression(statement.test);
  if (
    !isNodeOfType(test, "MemberExpression") ||
    test.optional ||
    getStaticPropertyName(test) !== "aborted" ||
    !sameBinding(test.object, bindings.signal, bindings.context)
  )
    return false;
  const statements = isNodeOfType(statement.consequent, "BlockStatement")
    ? statement.consequent.body
    : [statement.consequent];
  const lastStatement = statements.at(-1);
  if (!isNodeOfType(lastStatement, "ReturnStatement")) return false;
  return lastStatement.argument
    ? statements.length === 1 && isResolverSettlement(lastStatement, false, bindings)
    : statements.length === NATIVE_DELAY_SETTLEMENT_STATEMENT_COUNT &&
        isResolverSettlement(statements[0], false, bindings);
};

export const certifyNativeSignalDelay = (
  call: EsTreeNodeOfType<"CallExpression">,
  signal: EsTreeNode,
  context: RuleContext,
  project?: SourceProjectIndex,
  globalCache?: NativeDelayGlobalCache,
): boolean => {
  if (call.optional || call.arguments.length !== NATIVE_DELAY_MAX_ARGUMENT_COUNT) return false;
  const producerSymbol = resolveConstIdentifierAlias(
    stripParenExpression(call.callee),
    context.scopes,
  );
  if (!producerSymbol || !hasPrivateProducerReferences(producerSymbol, context)) return false;
  const producer = producerSymbol.initializer;
  if (
    !isFunctionLike(producer) ||
    producer.async ||
    producer.generator ||
    producer.params.length !== call.arguments.length ||
    producer.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return false;
  const signalIndex = call.arguments.findIndex((argument) => {
    const argumentBinding = resolveConstIdentifierAlias(
      stripParenExpression(argument),
      context.scopes,
    );
    const signalBinding = resolveConstIdentifierAlias(stripParenExpression(signal), context.scopes);
    return signalBinding ? argumentBinding === signalBinding : argument === signal;
  });
  if (signalIndex < 0) return false;
  const signalSymbol = context.scopes.symbolFor(producer.params[signalIndex]);
  const durationIndex = signalIndex === 0 ? 1 : 0;
  const durationSymbol = context.scopes.symbolFor(producer.params[durationIndex]);
  if (
    !signalSymbol ||
    !durationSymbol ||
    !isReadonlySymbol(signalSymbol) ||
    !isReadonlySymbol(durationSymbol) ||
    !isPrimitiveDelayArgument(call.arguments[durationIndex], context)
  )
    return false;
  const returnedExpression = getSingleReturnExpression(producer);
  const promise = returnedExpression && stripParenExpression(returnedExpression);
  if (
    !isNodeOfType(promise, "NewExpression") ||
    promise.arguments.length !== 1 ||
    !isProvenUnmodifiedGlobalNamespaceReference(promise.callee, "Promise", context.scopes)
  )
    return false;
  const executor = stripParenExpression(promise.arguments[0]);
  if (
    !isFunctionLike(executor) ||
    executor.async ||
    executor.generator ||
    executor.params.length !== 1 ||
    !isNodeOfType(executor.params[0], "Identifier")
  )
    return false;
  const resolver = context.scopes.symbolFor(executor.params[0]);
  const statements = getCallbackStatements(executor);
  if (!resolver || statements.length !== NATIVE_DELAY_EXECUTOR_STATEMENT_COUNT) return false;
  const declarations = statements.slice(1, -1).map(getConstDeclaration);
  const timerDeclaration = declarations.find(
    (declaration) =>
      declaration?.init &&
      isNativeCall(stripParenExpression(declaration.init), "setTimeout", context),
  );
  const abortDeclaration = declarations.find(
    (declaration) => declaration?.init && isFunctionLike(stripParenExpression(declaration.init)),
  );
  if (!timerDeclaration?.init || !abortDeclaration?.init) return false;
  const timer = context.scopes.symbolFor(timerDeclaration.id);
  const abort = context.scopes.symbolFor(abortDeclaration.id);
  if (!timer || !abort || !isReadonlySymbol(timer) || !isReadonlySymbol(abort)) return false;
  const bindings: NativeDelayBindings = { context, signal: signalSymbol, resolver, timer, abort };
  const timerCall = stripParenExpression(timerDeclaration.init);
  if (
    !isNativeCall(timerCall, "setTimeout", context) ||
    timerCall.arguments.length !== NATIVE_DELAY_MAX_ARGUMENT_COUNT ||
    !sameBinding(timerCall.arguments[1], durationSymbol, context)
  )
    return false;
  const listenerStatement = statements.at(-1);
  return (
    isAbortedEarlyExit(statements[0], bindings) &&
    isClosedSettlementCallback(stripParenExpression(timerCall.arguments[0]), true, bindings) &&
    isClosedSettlementCallback(stripParenExpression(abortDeclaration.init), false, bindings) &&
    Boolean(
      listenerStatement && isSignalListenerCall(listenerStatement, "addEventListener", bindings),
    ) &&
    hasClosedNativeDelayGlobals(context.scopes, project, globalCache)
  );
};
