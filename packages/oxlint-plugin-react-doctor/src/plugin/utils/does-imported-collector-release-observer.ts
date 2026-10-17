import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import {
  COLLECTOR_DRAIN_START_INDEX,
  COLLECTOR_UNSUPPORTED_GLOBAL_NAMES,
  COLLECTOR_UNSUPPORTED_MEMBER_NAMES,
  COLLECTOR_UNSUPPORTED_EXECUTION_DEPENDENCIES,
  EMPTY_COLLECTOR_COUNT,
  MAX_COLLECTOR_REGISTER_STATEMENTS,
  SINGLE_COLLECTOR_CALLBACK_COUNT,
} from "../constants/disposable-collector.js";
import { EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS } from "../constants/dom.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { doNodesCoverEveryPathAfterNode } from "./do-nodes-cover-every-path-after-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";
import { getImportedName } from "./get-imported-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

interface CollectorProtocol {
  registrationName: string;
  disposalName: string;
}
interface CollectorRegistration {
  call: EsTreeNodeOfType<"CallExpression">;
  collector: SymbolDescriptor;
  observer: EsTreeNode;
}
interface ImportedCollectorReleaseOptions {
  effectCallback: EsTreeNode;
  observerBinding: EsTreeNode;
  observationCalls: ReadonlyArray<EsTreeNode>;
  context: RuleContext;
}
const hasClosedNativeEnvironment = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  ignoredFunctions: ReadonlySet<EsTreeNode>,
): boolean => {
  let isClosed = true;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      !isTypeScriptTypePosition(node) &&
      [
        "Object",
        "Reflect",
        "Function",
        "require",
        "module",
        "Array",
        "process",
        "globalThis",
        "window",
        "self",
        "global",
      ].includes(node.name)
    ) {
      const symbol = scopes.symbolFor(node);
      if (
        symbol &&
        symbol.bindingIdentifier !== node &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isClosed || ignoredFunctions.has(node)) return false;
    if (isTypeScriptTypePosition(node)) return false;
    const dependency = getRuntimeStaticDependencySource(node);
    if (dependency && COLLECTOR_UNSUPPORTED_EXECUTION_DEPENDENCIES.has(dependency)) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression")) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const importedSymbol = scopes.symbolFor(node);
      const declaration =
        importedSymbol?.kind === "import" ? getImportDeclarationForSymbol(importedSymbol) : null;
      if (
        declaration?.source.value === "react" &&
        importedSymbol &&
        !isNodeOfType(importedSymbol.declarationNode, "ImportSpecifier")
      )
        isClosed = false;
    }
    if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      if (COLLECTOR_UNSUPPORTED_GLOBAL_NAMES.has(node.name)) isClosed = false;
      if (EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(node.name)) {
        const parent = findTransparentExpressionRoot(node).parent;
        if (
          !(isNodeOfType(parent, "NewExpression") && parent.callee === node) &&
          !(isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof")
        )
          isClosed = false;
      }
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, scopes);
      if (
        name === null ||
        COLLECTOR_UNSUPPORTED_MEMBER_NAMES.has(name) ||
        isMemberMutationTarget(node)
      )
        isClosed = false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (name === null || COLLECTOR_UNSUPPORTED_MEMBER_NAMES.has(name)) isClosed = false;
    }
  });
  return isClosed;
};
const isSameSymbol = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(stripParenExpression(node), "Identifier") &&
  scopes.symbolFor(stripParenExpression(node)) === symbol;
const getOnlyExpression = (body: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(body, "ExpressionStatement")) return body.expression;
  if (!isNodeOfType(body, "BlockStatement")) return body;
  const [statement] = body.body;
  return body.body.length === SINGLE_COLLECTOR_CALLBACK_COUNT &&
    isNodeOfType(statement, "ExpressionStatement")
    ? statement.expression
    : null;
};
const isCollectionCall = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  method: string,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === method &&
    isSameSymbol(callee.object, symbol, scopes)
  );
};
const getRegistrationCollection = (
  method: EsTreeNode,
  scopes: ScopeAnalysis,
  ignored: Set<EsTreeNode>,
): SymbolDescriptor | null => {
  if (
    !isFunctionLike(method) ||
    method.async ||
    method.generator ||
    method.params.length !== SINGLE_COLLECTOR_CALLBACK_COUNT ||
    !isNodeOfType(method.body, "BlockStatement")
  )
    return null;
  const [parameter] = method.params;
  const callback =
    parameter && isNodeOfType(parameter, "Identifier") ? scopes.symbolFor(parameter) : null;
  if (!callback || method.body.body.length > MAX_COLLECTOR_REGISTER_STATEMENTS) return null;
  const [storage, trailing] = method.body.body;
  if (trailing) {
    if (
      !isNodeOfType(trailing, "ReturnStatement") ||
      !trailing.argument ||
      !isFunctionLike(trailing.argument)
    )
      return null;
    ignored.add(trailing.argument);
  }
  let push: EsTreeNode | null = null;
  if (isNodeOfType(storage, "IfStatement")) push = getOnlyExpression(storage.consequent);
  else if (isNodeOfType(storage, "ExpressionStatement")) push = storage.expression;
  if (
    !isNodeOfType(push, "CallExpression") ||
    push.arguments.length !== SINGLE_COLLECTOR_CALLBACK_COUNT
  )
    return null;
  const callee = stripParenExpression(push.callee);
  const array =
    isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.object, "Identifier")
      ? scopes.symbolFor(callee.object)
      : null;
  const [argument] = push.arguments;
  const initializer = array && getDirectUnreassignedInitializer(array);
  if (
    !array ||
    !initializer ||
    !isNodeOfType(initializer, "ArrayExpression") ||
    initializer.elements.length !== EMPTY_COLLECTOR_COUNT ||
    !isCollectionCall(push, array, "push", scopes) ||
    !argument ||
    !isSameSymbol(argument, callback, scopes)
  )
    return null;
  if (isNodeOfType(storage, "IfStatement")) {
    const test = stripParenExpression(storage.test);
    if (
      storage.alternate ||
      !isNodeOfType(test, "UnaryExpression") ||
      test.operator !== "!" ||
      !isCollectionCall(test.argument, array, "includes", scopes) ||
      test.argument.arguments.length !== SINGLE_COLLECTOR_CALLBACK_COUNT ||
      !isSameSymbol(test.argument.arguments[COLLECTOR_DRAIN_START_INDEX], callback, scopes)
    )
      return null;
  }
  return array;
};
const drainsCollection = (
  method: EsTreeNode,
  array: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isFunctionLike(method) ||
    method.async ||
    method.generator ||
    method.params.length !== EMPTY_COLLECTOR_COUNT ||
    !isNodeOfType(method.body, "BlockStatement") ||
    method.body.body.length !== SINGLE_COLLECTOR_CALLBACK_COUNT
  )
    return false;
  const [loop] = method.body.body;
  if (
    !isNodeOfType(loop, "ForOfStatement") ||
    loop.await ||
    !isCollectionCall(loop.right, array, "splice", scopes) ||
    loop.right.arguments.length !== SINGLE_COLLECTOR_CALLBACK_COUNT
  )
    return false;
  const [start] = loop.right.arguments;
  if (
    !isNodeOfType(start, "Literal") ||
    start.value !== COLLECTOR_DRAIN_START_INDEX ||
    !isNodeOfType(loop.left, "VariableDeclaration") ||
    loop.left.declarations.length !== SINGLE_COLLECTOR_CALLBACK_COUNT
  )
    return false;
  const [declarator] = loop.left.declarations;
  const callback =
    declarator && isNodeOfType(declarator.id, "Identifier")
      ? scopes.symbolFor(declarator.id)
      : null;
  const invocation = getOnlyExpression(loop.body);
  return Boolean(
    callback &&
    !declarator.init &&
    isNodeOfType(invocation, "CallExpression") &&
    invocation.arguments.length === EMPTY_COLLECTOR_COUNT &&
    isSameSymbol(invocation.callee, callback, scopes) &&
    callback.references.every((reference) => reference.flag === "read"),
  );
};
const getCollectorProtocols = (
  factory: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): CollectorProtocol[] => {
  if (
    !isFunctionLike(factory) ||
    factory.async ||
    factory.generator ||
    factory.params.length !== EMPTY_COLLECTOR_COUNT ||
    !isNodeOfType(factory.body, "BlockStatement")
  )
    return [];
  const factoryBinding = getFunctionBindingIdentifier(factory);
  const factorySymbol = factoryBinding && scopes.symbolFor(factoryBinding);
  if (
    !factorySymbol ||
    [...new Set([factorySymbol, ...getFunctionBindingSymbols(factory, scopes)])].some((symbol) =>
      symbol.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      ),
    )
  )
    return [];
  const returns = collectFunctionReturnStatements(factory);
  const [returned] = returns;
  if (
    returns.length !== SINGLE_COLLECTOR_CALLBACK_COUNT ||
    !returned?.argument ||
    returned.parent !== factory.body
  )
    return [];
  const value = stripParenExpression(returned.argument);
  const api = isNodeOfType(value, "Identifier") ? scopes.symbolFor(value) : null;
  const object = api ? getDirectUnreassignedInitializer(api) : value;
  if (!isNodeOfType(object, "ObjectExpression")) return [];
  if (
    !factory.body.body.every(
      (statement) =>
        statement === returned ||
        (isNodeOfType(statement, "VariableDeclaration") &&
          statement.declarations.every(
            (declaration) =>
              isNodeOfType(declaration.id, "Identifier") &&
              declaration.init &&
              ((isNodeOfType(declaration.init, "ObjectExpression") &&
                declaration.init === object) ||
                (isNodeOfType(declaration.init, "ArrayExpression") &&
                  declaration.init.elements.length === EMPTY_COLLECTOR_COUNT)),
          )),
    )
  )
    return [];
  const methods = new Map<string, EsTreeNode>();
  for (const property of object.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      !isFunctionLike(property.value)
    )
      return [];
    const name = getStaticPropertyKeyName(property);
    if (!name || name === "__proto__" || methods.has(name)) return [];
    methods.set(name, property.value);
  }
  const protocols: CollectorProtocol[] = [];
  for (const [registrationName, registration] of methods) {
    const ignored = new Set<EsTreeNode>();
    const array = getRegistrationCollection(registration, scopes, ignored);
    if (!array || findEnclosingFunction(array.declarationNode) !== factory) continue;
    for (const [disposalName, disposal] of methods) {
      if (disposalName === registrationName || !drainsCollection(disposal, array, scopes)) continue;
      const ignoredFunctions = new Set(ignored);
      for (const method of methods.values())
        if (method !== registration && method !== disposal) ignoredFunctions.add(method);
      if (!hasClosedNativeEnvironment(program, scopes, ignoredFunctions)) continue;
      const supportedArrayUse = array.references.every(
        (reference) =>
          reference.flag === "read" &&
          (isAstDescendant(reference.identifier, registration) ||
            isAstDescendant(reference.identifier, disposal) ||
            [...ignoredFunctions].some((method) => isAstDescendant(reference.identifier, method))),
      );
      if (!supportedArrayUse) continue;
      protocols.push({ registrationName, disposalName });
    }
  }
  return protocols;
};
const getReleasedObserverBinding = (
  callback: EsTreeNode,
  effect: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== EMPTY_COLLECTOR_COUNT
  )
    return null;
  const call = getOnlyExpression(callback.body);
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== EMPTY_COLLECTOR_COUNT)
    return null;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "disconnect" ||
    !isNodeOfType(callee.object, "Identifier")
  )
    return null;
  const symbol = context.scopes.symbolFor(callee.object);
  const construction = symbol && getDirectUnreassignedInitializer(symbol);
  if (
    !symbol ||
    !isNodeOfType(construction, "NewExpression") ||
    findEnclosingFunction(construction) !== effect ||
    !isNodeOfType(construction.callee, "Identifier") ||
    !context.scopes.isGlobalReference(construction.callee) ||
    !EXTERNAL_SYNC_OBSERVER_CONSTRUCTORS.has(construction.callee.name)
  )
    return null;
  const [callbackArgument] = construction.arguments;
  let observerCallback: EsTreeNode | null = callbackArgument
    ? stripParenExpression(callbackArgument)
    : null;
  if (isNodeOfType(observerCallback, "Identifier")) {
    const callbackSymbol = context.scopes.symbolFor(observerCallback);
    if (
      !callbackSymbol ||
      callbackSymbol.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      )
    )
      return null;
    observerCallback = getDirectUnreassignedInitializer(callbackSymbol);
  }
  if (
    !isFunctionLike(observerCallback) ||
    observerCallback.params.length > SINGLE_COLLECTOR_CALLBACK_COUNT ||
    observerCallback.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return null;
  let hasOpaqueCallbackInput = false;
  walkAst(observerCallback, (node) => {
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    )
      hasOpaqueCallbackInput = true;
  });
  if (isNodeOfType(observerCallback, "FunctionExpression") && observerCallback.id) {
    const selfSymbol = context.scopes.symbolFor(observerCallback.id);
    if (selfSymbol?.references.length) hasOpaqueCallbackInput = true;
  }
  if (hasOpaqueCallbackInput) return null;
  if (
    !symbol.references.every((reference) => {
      const member = findTransparentExpressionRoot(reference.identifier).parent;
      const invocation = member?.parent;
      return (
        reference.flag === "read" &&
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        isNodeOfType(invocation, "CallExpression") &&
        ((getStaticPropertyName(member) === "observe" &&
          findEnclosingFunction(invocation) === effect) ||
          (getStaticPropertyName(member) === "disconnect" &&
            findEnclosingFunction(invocation) === callback)) &&
        invocation.callee === member
      );
    })
  )
    return null;
  return symbol.bindingIdentifier;
};
export const doesImportedCollectorReleaseObserver = ({
  effectCallback,
  observerBinding,
  observationCalls,
  context,
}: ImportedCollectorReleaseOptions): boolean => {
  if (
    !context.filename ||
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    (isNodeOfType(effectCallback, "FunctionExpression") && effectCallback.id !== null) ||
    effectCallback.params.length !== EMPTY_COLLECTOR_COUNT
  )
    return false;
  const effectCall = findTransparentExpressionRoot(effectCallback).parent;
  if (!isNodeOfType(effectCall, "CallExpression") || !isNodeOfType(effectCall.callee, "Identifier"))
    return false;
  const effectSymbol = context.scopes.symbolFor(effectCall.callee);
  const effectImport = effectSymbol && getImportDeclarationForSymbol(effectSymbol);
  if (
    !effectSymbol ||
    effectSymbol.kind !== "import" ||
    !effectImport ||
    effectImport.source.value !== "react" ||
    effectImport.importKind === "type" ||
    !isNodeOfType(effectSymbol.declarationNode, "ImportSpecifier") ||
    effectSymbol.declarationNode.importKind === "type" ||
    !["useEffect", "useLayoutEffect", "useInsertionEffect"].includes(
      getImportedName(effectSymbol.declarationNode) ?? "",
    ) ||
    !effectSymbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier,
    )
  )
    return false;
  const program = findProgramRoot(effectCallback);
  if (!program || !hasClosedNativeEnvironment(program, context.scopes, new Set())) return false;
  const registrations: CollectorRegistration[] = [];
  let hasUnsupportedCompletion = false;
  walkAst(effectCallback.body, (node) => {
    if (node !== effectCallback.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "TryStatement")) {
      hasUnsupportedCompletion = true;
      return false;
    }
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.arguments.length !== SINGLE_COLLECTOR_CALLBACK_COUNT
    )
      return;
    const callee = stripParenExpression(node.callee);
    const [callback] = node.arguments;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(callee.object, "Identifier") ||
      !callback
    )
      return;
    const collector = context.scopes.symbolFor(callee.object);
    const observer = getReleasedObserverBinding(callback, effectCallback, context);
    if (collector && observer) registrations.push({ call: node, collector, observer });
  });
  if (hasUnsupportedCompletion) return false;
  for (const registration of registrations) {
    if (registration.observer !== observerBinding) continue;
    const collector = registration.collector;
    const factoryCall = getDirectUnreassignedInitializer(collector);
    if (
      !isNodeOfType(factoryCall, "CallExpression") ||
      factoryCall.arguments.length !== EMPTY_COLLECTOR_COUNT ||
      findEnclosingFunction(factoryCall) !== effectCallback ||
      !isNodeOfType(factoryCall.callee, "Identifier")
    )
      continue;
    const imported = resolveImportedApiReference(factoryCall.callee, context.scopes);
    const factorySymbol = context.scopes.symbolFor(factoryCall.callee);
    if (
      !imported?.importedName ||
      !imported.source.startsWith(".") ||
      !factorySymbol ||
      factorySymbol.kind !== "import" ||
      !factorySymbol.references.every(
        (reference) =>
          reference.flag === "read" &&
          isNodeOfType(reference.identifier.parent, "CallExpression") &&
          reference.identifier.parent.callee === reference.identifier,
      )
    )
      continue;
    const resolved = resolveCrossFileFunctionExportWithFilePath(
      context.filename,
      imported.source,
      imported.importedName,
    );
    if (!resolved) continue;
    for (const protocol of getCollectorProtocols(
      resolved.functionNode,
      resolved.programNode,
      analyzeScopes(resolved.programNode),
    )) {
      const disposalCalls: EsTreeNode[] = [];
      const sameCollectorRegistrations = registrations.filter(
        (candidate) =>
          candidate.collector === collector &&
          isNodeOfType(candidate.call.callee, "MemberExpression") &&
          getStaticPropertyName(candidate.call.callee) === protocol.registrationName,
      );
      const referencesClosed = collector.references.every((reference) => {
        const member = findTransparentExpressionRoot(reference.identifier).parent;
        const call = member?.parent;
        if (
          reference.flag !== "read" ||
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== reference.identifier ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== member
        )
          return false;
        if (getStaticPropertyName(member) === protocol.registrationName)
          return (
            sameCollectorRegistrations.some((candidate) => candidate.call === call) &&
            isNodeOfType(call.parent, "ExpressionStatement")
          );
        if (
          getStaticPropertyName(member) !== protocol.disposalName ||
          call.arguments.length !== EMPTY_COLLECTOR_COUNT
        )
          return false;
        disposalCalls.push(call);
        return true;
      });
      if (!referencesClosed || !sameCollectorRegistrations.includes(registration)) continue;
      const cleanupReturns = collectFunctionReturnStatements(effectCallback).filter((statement) => {
        const cleanup = statement.argument && stripParenExpression(statement.argument);
        return (
          isFunctionLike(cleanup) &&
          !cleanup.async &&
          !cleanup.generator &&
          cleanup.params.length === EMPTY_COLLECTOR_COUNT &&
          disposalCalls.some((call) => getOnlyExpression(cleanup.body) === call)
        );
      });
      if (
        observationCalls.every((observation) =>
          doNodesCoverEveryPathAfterNode(observation, [registration.call], context),
        ) &&
        doNodesCoverEveryPathAfterNode(registration.call, cleanupReturns, context)
      )
        return true;
    }
  }
  return false;
};
