import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import {
  INTERVAL_CALLBACK_ARGUMENT_INDEX,
  INTERVAL_CLEANUP_ARGUMENT_COUNT,
  INTERVAL_DELAY_ARGUMENT_INDEX,
  INTERVAL_EFFECT_TRAILING_STATEMENT_COUNT,
  INTERVAL_ERASED_SYMBOL_KINDS,
  INTERVAL_GLOBAL_CARRIER_NAMES,
  INTERVAL_HANDLE_REFERENCE_COUNT,
  INTERVAL_NATIVE_CALL_NAMES,
  INTERVAL_NATIVE_FACTORY_NAMES,
  INTERVAL_REFLECTIVE_GLOBAL_NAMES,
  INTERVAL_REGISTRATION_ARGUMENT_COUNT,
  INTERVAL_RUNTIME_TS_NODE_TYPES,
  INTERVAL_SINGLE_BINDING_COUNT,
  INTERVAL_STATE_DISPATCHER_INDEX,
  INTERVAL_STATE_HOOK_NAMES,
  INTERVAL_STATE_TUPLE_COUNT,
  INTERVAL_UNSUPPORTED_PROPERTY_NAMES,
  INTERVAL_ZERO_PARAMETER_COUNT,
} from "./native-interval-effect/constants.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isLiteralVoidExpression } from "../../../utils/is-literal-void-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isReactHookResultReference } from "../../../utils/is-react-hook-result-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export interface NativeIntervalEffectCallback {
  callback: EsTreeNodeOfType<"ArrowFunctionExpression">;
  cleanup: EsTreeNodeOfType<"ArrowFunctionExpression">;
}

interface IntervalProgramFacts {
  supported: boolean;
  blockedNames: ReadonlySet<string>;
}

const intervalProgramFactsByAnalysis = new WeakMap<ScopeAnalysis, IntervalProgramFacts>();
const closedDispatcherReferencesBySymbol = new WeakMap<SymbolDescriptor, boolean>();

const isDirectCallCallee = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  const consumer = root.parent;
  return isNodeOfType(consumer, "CallExpression") && !consumer.optional && consumer.callee === root;
};

const isNativeCall = (
  node: EsTreeNode,
  name: string,
  context: RuleContext,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === name &&
  context.scopes.isGlobalReference(node.callee);

const isReactNamespaceSymbol = (symbol: SymbolDescriptor): boolean =>
  getValueImportSource(symbol) === "react" &&
  (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
    getImportedName(symbol.declarationNode) === "default");

const isValueReactCall = (
  node: EsTreeNode,
  names: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = context.scopes.symbolFor(callee);
    const importedName = symbol ? getImportedName(symbol.declarationNode) : undefined;
    return Boolean(
      symbol && getValueImportSource(symbol) === "react" && importedName && names.has(importedName),
    );
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    !isNodeOfType(callee.object, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(callee.object);
  const name = getResolvedStaticPropertyName(callee, context.scopes);
  return Boolean(symbol && isReactNamespaceSymbol(symbol) && name && names.has(name));
};

const hasClosedReactProvider = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    if (reference.flag !== "read") return false;
    if (!isReactNamespaceSymbol(symbol)) return isDirectCallCallee(reference.identifier);
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    return (
      isNodeOfType(member, "MemberExpression") &&
      member.object === root &&
      !member.optional &&
      !member.computed &&
      isDirectCallCallee(member)
    );
  });

const collectIntervalProgramFacts = (
  program: EsTreeNode,
  context: RuleContext,
): IntervalProgramFacts => {
  const blockedNames = new Set<string>();
  const unsupported = { supported: false, blockedNames };
  const pendingScopes = [context.scopes.rootScope];
  const symbols: SymbolDescriptor[] = [];
  const providerNames = new Set<string>();
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) break;
    if (scope.kind === "with" || scope.kind === "ts-module" || scope.kind === "ts-enum")
      return unsupported;
    pendingScopes.push(...scope.children);
    symbols.push(...scope.symbols);
    for (const symbol of scope.symbols) {
      if (getValueImportSource(symbol) === "react") providerNames.add(symbol.name);
    }
  }
  for (const symbol of symbols) {
    if (INTERVAL_ERASED_SYMBOL_KINDS.has(symbol.kind)) blockedNames.add(symbol.name);
    if (symbol.kind !== "import") continue;
    const source = getValueImportSource(symbol);
    if (!source) blockedNames.add(symbol.name);
    const importedName = getImportedName(symbol.declarationNode);
    if (
      source === "react" &&
      (isReactNamespaceSymbol(symbol) ||
        Boolean(
          importedName &&
          (EFFECT_HOOK_NAMES.has(importedName) || INTERVAL_STATE_HOOK_NAMES.has(importedName)),
        ))
    ) {
      if (!hasClosedReactProvider(symbol)) return unsupported;
    }
  }
  for (const providerName of providerNames) {
    if (blockedNames.has(providerName)) return unsupported;
  }
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      INTERVAL_RUNTIME_TS_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && context.scopes.referenceFor(node)) {
      if (
        node.name === "eval" ||
        (context.scopes.isGlobalReference(node) &&
          (INTERVAL_GLOBAL_CARRIER_NAMES.has(node.name) ||
            INTERVAL_REFLECTIVE_GLOBAL_NAMES.has(node.name)))
      ) {
        supported = false;
        return false;
      }
      if (
        context.scopes.isGlobalReference(node) &&
        INTERVAL_NATIVE_CALL_NAMES.has(node.name) &&
        !isDirectCallCallee(node)
      )
        supported = false;
      if (
        context.scopes.isGlobalReference(node) &&
        (INTERVAL_NATIVE_FACTORY_NAMES.has(node.name) || node.name === "AbortController")
      ) {
        const root = findTransparentExpressionRoot(node);
        const consumer = root.parent;
        if (
          !isDirectCallCallee(node) &&
          !(isNodeOfType(consumer, "NewExpression") && consumer.callee === root)
        )
          supported = false;
      }
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, context.scopes, {
        stringifyNonStringLiterals: true,
      });
      if ((name && INTERVAL_UNSUPPORTED_PROPERTY_NAMES.has(name)) || (!name && node.computed))
        supported = false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getResolvedStaticPropertyName(node, context.scopes, {
        stringifyNonStringLiterals: true,
      });
      if ((name && INTERVAL_UNSUPPORTED_PROPERTY_NAMES.has(name)) || (!name && node.computed))
        supported = false;
    }
    return undefined;
  });
  return { supported, blockedNames };
};

const hasSupportedIntervalProgram = (
  anchor: EsTreeNode,
  protectedNames: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(anchor);
  if (!program) return false;
  let facts = intervalProgramFactsByAnalysis.get(context.scopes);
  if (!facts) {
    facts = collectIntervalProgramFacts(program, context);
    intervalProgramFactsByAnalysis.set(context.scopes, facts);
  }
  if (!facts.supported) return false;
  for (const protectedName of protectedNames) {
    if (facts.blockedNames.has(protectedName)) return false;
  }
  return true;
};

const isSupportedEffectPrefix = (
  node: EsTreeNode,
  protectedNames: Set<string>,
  context: RuleContext,
): boolean => {
  if (isNodeOfType(node, "ExpressionStatement") && isLiteralVoidExpression(node.expression))
    return true;
  if (
    !isNodeOfType(node, "VariableDeclaration") ||
    node.declarations.length !== INTERVAL_SINGLE_BINDING_COUNT
  )
    return false;
  const declaration = node.declarations[INTERVAL_CALLBACK_ARGUMENT_INDEX];
  if (!declaration || !isNodeOfType(declaration.id, "Identifier") || !declaration.init)
    return false;
  protectedNames.add(declaration.id.name);
  const initializer = stripParenExpression(declaration.init);
  return (
    (node.kind === "let" &&
      isNodeOfType(initializer, "Literal") &&
      typeof initializer.value === "boolean") ||
    (node.kind === "const" &&
      isNodeOfType(initializer, "NewExpression") &&
      initializer.arguments.length === INTERVAL_ZERO_PARAMETER_COUNT &&
      isNodeOfType(initializer.callee, "Identifier") &&
      initializer.callee.name === "AbortController" &&
      context.scopes.isGlobalReference(initializer.callee))
  );
};

const hasClosedStateDispatchers = (
  callback: EsTreeNode,
  owner: EsTreeNode,
  protectedNames: Set<string>,
  context: RuleContext,
): boolean => {
  let supported = true;
  let hasDispatcher = false;
  walkAst(callback, (node) => {
    if (!supported) return false;
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "Identifier") ||
      !isReactHookResultReference(
        node.callee,
        INTERVAL_STATE_HOOK_NAMES,
        INTERVAL_STATE_DISPATCHER_INDEX,
        context.scopes,
      )
    )
      return;
    const symbol = context.scopes.symbolFor(node.callee);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "ArrayPattern") ||
      declaration.id.elements.length !== INTERVAL_STATE_TUPLE_COUNT ||
      declaration.id.elements[INTERVAL_STATE_DISPATCHER_INDEX] !== symbol.bindingIdentifier ||
      findEnclosingFunction(declaration) !== owner ||
      !declaration.init ||
      !isValueReactCall(declaration.init, INTERVAL_STATE_HOOK_NAMES, context)
    ) {
      supported = false;
      return false;
    }
    let referencesAreClosed = closedDispatcherReferencesBySymbol.get(symbol);
    if (referencesAreClosed === undefined) {
      referencesAreClosed = symbol.references.every(
        (reference) =>
          reference.flag === "read" &&
          isDirectCallCallee(reference.identifier) &&
          isAstDescendant(reference.identifier, owner),
      );
      closedDispatcherReferencesBySymbol.set(symbol, referencesAreClosed);
    }
    if (!referencesAreClosed) {
      supported = false;
      return false;
    }
    hasDispatcher = true;
    protectedNames.add(symbol.name);
    return undefined;
  });
  return supported && hasDispatcher;
};

export const getNativeIntervalEffectCallback = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
  effectCallback: EsTreeNode,
  context: RuleContext,
): NativeIntervalEffectCallback | null => {
  if (
    !isValueReactCall(effectCall, EFFECT_HOOK_NAMES, context) ||
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") ||
    effectCallback.async ||
    effectCallback.params.length !== INTERVAL_ZERO_PARAMETER_COUNT ||
    !isNodeOfType(effectCallback.body, "BlockStatement")
  )
    return null;
  const owner = findEnclosingFunction(effectCall);
  if (!owner) return null;
  const statements = effectCallback.body.body;
  const registrationStatement = statements.at(-INTERVAL_EFFECT_TRAILING_STATEMENT_COUNT);
  const returnStatement = statements.at(-INTERVAL_SINGLE_BINDING_COUNT);
  if (
    !isNodeOfType(registrationStatement, "VariableDeclaration") ||
    registrationStatement.kind !== "const" ||
    registrationStatement.declarations.length !== INTERVAL_SINGLE_BINDING_COUNT ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !returnStatement.argument ||
    !isNodeReachableWithinFunction(registrationStatement, context)
  )
    return null;
  const declaration = registrationStatement.declarations[INTERVAL_CALLBACK_ARGUMENT_INDEX];
  if (
    !declaration ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !declaration.init ||
    !isNativeCall(declaration.init, "setInterval", context)
  )
    return null;
  const registration = declaration.init;
  const callback = registration.arguments[INTERVAL_CALLBACK_ARGUMENT_INDEX];
  const delay = registration.arguments[INTERVAL_DELAY_ARGUMENT_INDEX];
  const cleanup = stripParenExpression(returnStatement.argument);
  if (
    registration.arguments.length !== INTERVAL_REGISTRATION_ARGUMENT_COUNT ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !callback.async ||
    callback.params.length !== INTERVAL_ZERO_PARAMETER_COUNT ||
    !isNodeOfType(delay, "Literal") ||
    typeof delay.value !== "number" ||
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    cleanup.params.length !== INTERVAL_ZERO_PARAMETER_COUNT
  )
    return null;
  const protectedNames = new Set([
    ...INTERVAL_NATIVE_CALL_NAMES,
    ...INTERVAL_GLOBAL_CARRIER_NAMES,
    "AbortController",
    declaration.id.name,
  ]);
  if (
    !statements
      .slice(INTERVAL_CALLBACK_ARGUMENT_INDEX, -INTERVAL_EFFECT_TRAILING_STATEMENT_COUNT)
      .every((statement) => isSupportedEffectPrefix(statement, protectedNames, context))
  )
    return null;
  const symbol = context.scopes.symbolFor(declaration.id);
  if (!symbol || symbol.references.length !== INTERVAL_HANDLE_REFERENCE_COUNT) return null;
  const reference = symbol.references[INTERVAL_CALLBACK_ARGUMENT_INDEX];
  if (!reference || reference.flag !== "read") return null;
  const handle = findTransparentExpressionRoot(reference.identifier);
  const release = handle.parent;
  if (
    !release ||
    !isNativeCall(release, "clearInterval", context) ||
    release.arguments.length !== INTERVAL_CLEANUP_ARGUMENT_COUNT ||
    release.arguments[INTERVAL_CALLBACK_ARGUMENT_INDEX] !== handle ||
    !isAstDescendant(release, cleanup)
  )
    return null;
  if (isNodeOfType(cleanup.body, "BlockStatement")) {
    const cleanupStatements = cleanup.body.body.filter(
      (statement) =>
        !isNodeOfType(statement, "ExpressionStatement") ||
        !isLiteralVoidExpression(statement.expression),
    );
    if (
      !cleanupStatements.every(
        (statement, statementIndex) =>
          (isNodeOfType(statement, "ReturnStatement") &&
            statementIndex === cleanupStatements.length - INTERVAL_SINGLE_BINDING_COUNT &&
            Boolean(statement.argument && stripParenExpression(statement.argument) === release)) ||
          (isNodeOfType(statement, "ExpressionStatement") &&
            (statement.expression === release ||
              (isNodeOfType(statement.expression, "AssignmentExpression") &&
                statement.expression.operator === "=" &&
                isNodeOfType(statement.expression.left, "Identifier") &&
                isNodeOfType(statement.expression.right, "Literal") &&
                typeof statement.expression.right.value === "boolean" &&
                protectedNames.has(statement.expression.left.name)) ||
              (isNodeOfType(statement.expression, "CallExpression") &&
                !statement.expression.optional &&
                statement.expression.arguments.length === INTERVAL_ZERO_PARAMETER_COUNT &&
                isNodeOfType(statement.expression.callee, "MemberExpression") &&
                !statement.expression.callee.optional &&
                isNodeOfType(statement.expression.callee.object, "Identifier") &&
                protectedNames.has(statement.expression.callee.object.name) &&
                getResolvedStaticPropertyName(statement.expression.callee, context.scopes) ===
                  "abort"))),
      )
    )
      return null;
  } else if (stripParenExpression(cleanup.body) !== release) return null;
  if (!hasClosedStateDispatchers(callback, owner, protectedNames, context)) return null;
  if (!hasSupportedIntervalProgram(effectCall, protectedNames, context)) return null;
  return { callback, cleanup };
};
