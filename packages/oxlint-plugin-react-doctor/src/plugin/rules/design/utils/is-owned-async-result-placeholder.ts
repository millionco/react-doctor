import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../../utils/component-or-hook-display-name.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import {
  resolveReactUseStatePair,
  type ReactUseStatePair,
} from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const PLACEHOLDER_TEXTS = new Set(["...", "…", "•••"]);
const CODE_GLOBAL_NAMES = ["Function", "module", "process", "Reflect"];
const CODE_MEMBER_NAMES = new Set([
  "eval",
  "require",
  "Function",
  "constructor",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "createRequire",
  "getBuiltinModule",
  "_load",
  "_compile",
  "compileFunction",
  "runInContext",
  "runInNewContext",
  "runInThisContext",
]);
const CODE_MODULE_NAMES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "inspector",
  "node:inspector",
]);
const providerUncertaintyByScopes = new WeakMap<ScopeAnalysis, boolean>();

const runtimeReferences = (symbol: SymbolDescriptor) =>
  symbol.references.filter((reference) => !isTypeScriptTypePosition(reference.identifier));

const hasProviderUncertainty = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = providerUncertaintyByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let uncertain = false;
  walkAst(program, (node) => {
    if (uncertain || isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "ImportDeclaration") && isTypeOnlyImport(node)) ||
      (isNodeOfType(node, "ImportSpecifier") && node.importKind === "type") ||
      ((isNodeOfType(node, "TSEnumDeclaration") ||
        isNodeOfType(node, "TSModuleDeclaration") ||
        isNodeOfType(node, "ClassDeclaration")) &&
        node.declare)
    )
      return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      const source = node.source.value;
      uncertain =
        CODE_MODULE_NAMES.has(source) ||
        source.startsWith("react/") ||
        (source === "react" &&
          (!node.specifiers.length ||
            node.specifiers.some(
              (specifier) =>
                !isNodeOfType(specifier, "ImportSpecifier") ||
                (specifier.importKind !== "type" &&
                  Boolean(getImportedName(specifier)?.startsWith("__"))),
            )));
    } else if (isNodeOfType(node, "Identifier") && scopes.referenceFor(node)) {
      const symbol = scopes.symbolFor(node);
      const property = symbol && getDestructuredBindingPropertyName(symbol.bindingIdentifier);
      uncertain =
        node.name === "eval" ||
        node.name === "require" ||
        CODE_GLOBAL_NAMES.some((name) => isProvenGlobalNamespaceReference(node, name, scopes)) ||
        Boolean(property && CODE_MEMBER_NAMES.has(property));
    } else if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      uncertain =
        property === null ||
        property === "useState" ||
        property === "useEffect" ||
        CODE_MEMBER_NAMES.has(property) ||
        property.startsWith("__");
    } else if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSParameterProperty") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment")
    ) {
      uncertain = true;
    }
  });
  providerUncertaintyByScopes.set(scopes, uncertain);
  return uncertain;
};

const isDirectNativeHookCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (call.optional || !isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  const api = resolveImportedApiReference(callee, scopes);
  return Boolean(
    symbol?.kind === "import" &&
    isSymbolReadOnly(symbol) &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    api?.source === "react" &&
    api.importedName === name &&
    !api.isNamespace &&
    runtimeReferences(symbol).every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      return isNodeOfType(root.parent, "CallExpression") && root.parent.callee === root;
    }),
  );
};

const getDirectStatePair = (
  identifier: EsTreeNodeOfType<"Identifier">,
  body: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
): ReactUseStatePair | null => {
  const state = scopes.symbolFor(identifier);
  const declaration = state?.declarationNode;
  if (
    state?.kind !== "const" ||
    !isSymbolReadOnly(state) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declaration.parent.declarations.some((candidate) => candidate !== declaration) ||
    declaration.parent.parent !== body ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isDirectNativeHookCall(declaration.init, "useState", scopes)
  )
    return null;
  const [value, setter, ...otherBindings] = declaration.id.elements;
  const [initial, ...otherArguments] = declaration.init.arguments;
  if (
    otherBindings.length ||
    otherArguments.length ||
    !initial ||
    value !== state.bindingIdentifier ||
    !isNodeOfType(setter, "Identifier")
  )
    return null;
  const pair = resolveReactUseStatePair(setter, scopes);
  return pair?.stateSymbol === state && isSymbolReadOnly(pair.setterSymbol) ? pair : null;
};

const isSimpleCatch = (
  handler: EsTreeNodeOfType<"CatchClause"> | null | undefined,
  scopes: ScopeAnalysis,
): boolean =>
  !handler ||
  ((!handler.param || isNodeOfType(handler.param, "Identifier")) &&
    handler.body.body.every((statement) => {
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      const call = stripParenExpression(statement.expression);
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        !isNodeOfType(call.callee, "MemberExpression") ||
        !isNodeOfType(call.callee.object, "Identifier") ||
        call.callee.object.name !== "console" ||
        !scopes.isGlobalReference(call.callee.object) ||
        !isNodeOfType(call.callee.property, "Identifier") ||
        !["warn", "error", "log"].includes(call.callee.property.name)
      )
        return false;
      return call.arguments.every(
        (argument) =>
          isNodeOfType(argument, "Literal") ||
          (isNodeOfType(argument, "Identifier") &&
            isNodeOfType(handler.param, "Identifier") &&
            scopes.symbolFor(argument) === scopes.symbolFor(handler.param)),
      );
    }));

export const isOwnedAsyncResultPlaceholder = (
  element: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const opening = element.openingElement;
  const [attribute, ...otherAttributes] = opening.attributes;
  const [child, ...otherChildren] = element.children;
  if (
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "span" ||
    otherAttributes.length ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "className" ||
    !isNodeOfType(attribute.value, "Literal") ||
    typeof attribute.value.value !== "string" ||
    otherChildren.length ||
    !isNodeOfType(child, "JSXText") ||
    !PLACEHOLDER_TEXTS.has(child.value.trim())
  )
    return false;
  const conditional = element.parent;
  if (
    !isNodeOfType(conditional, "ConditionalExpression") ||
    conditional.consequent !== element ||
    !isNodeOfType(conditional.test, "Identifier") ||
    !isNodeOfType(conditional.alternate, "Identifier")
  )
    return false;
  const owner = findEnclosingFunction(element);
  if (
    (!isNodeOfType(owner, "FunctionDeclaration") &&
      !isNodeOfType(owner, "FunctionExpression") &&
      !isNodeOfType(owner, "ArrowFunctionExpression")) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !componentOrHookDisplayNameForFunction(owner)
  )
    return false;
  const pending = getDirectStatePair(conditional.test, owner.body, scopes);
  const result = getDirectStatePair(conditional.alternate, owner.body, scopes);
  if (!pending?.stateSymbol || !result?.stateSymbol || pending.stateSymbol === result.stateSymbol)
    return false;
  const pendingCall = pending.declarator.init;
  const resultCall = result.declarator.init;
  if (
    !isNodeOfType(pendingCall, "CallExpression") ||
    !isNodeOfType(resultCall, "CallExpression") ||
    !isNodeOfType(resultCall.arguments[0], "Literal")
  )
    return false;
  const [pendingInitial] = pendingCall.arguments;
  if (!isNodeOfType(pendingInitial, "Literal") || pendingInitial.value !== true) return false;
  if (
    !runtimeReferences(pending.stateSymbol).every(
      (reference) => reference.identifier === conditional.test,
    ) ||
    !runtimeReferences(result.stateSymbol).every(
      (reference) => reference.identifier === conditional.alternate,
    )
  )
    return false;
  const [pendingWrite, ...otherPendingWrites] = runtimeReferences(pending.setterSymbol);
  const settle = pendingWrite?.identifier.parent;
  if (
    otherPendingWrites.length ||
    !isNodeOfType(settle, "CallExpression") ||
    settle.callee !== pendingWrite?.identifier ||
    settle.optional ||
    !isNodeOfType(settle.parent, "ExpressionStatement")
  )
    return false;
  const [settledValue, ...otherSettledValues] = settle.arguments;
  if (
    otherSettledValues.length ||
    !isNodeOfType(settledValue, "Literal") ||
    settledValue.value !== false
  )
    return false;
  const finalizer = settle.parent.parent;
  const tried = finalizer?.parent;
  if (
    !isNodeOfType(finalizer, "BlockStatement") ||
    !isNodeOfType(tried, "TryStatement") ||
    tried.finalizer !== finalizer ||
    finalizer.body.some((statement) => statement !== settle.parent) ||
    !isSimpleCatch(tried.handler, scopes)
  )
    return false;
  const worker = findEnclosingFunction(tried);
  if (
    !isNodeOfType(worker, "ArrowFunctionExpression") ||
    !worker.async ||
    worker.params.length ||
    !isNodeOfType(worker.body, "BlockStatement") ||
    worker.body.body.some((statement) => statement !== tried)
  )
    return false;
  const declaration = worker.parent;
  const workerStatement = declaration?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== worker ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(workerStatement, "VariableDeclaration") ||
    workerStatement.kind !== "const" ||
    workerStatement.declarations.some((candidate) => candidate !== declaration)
  )
    return false;
  const workerSymbol = scopes.symbolFor(declaration.id);
  if (!workerSymbol || !isSymbolReadOnly(workerSymbol)) return false;
  const [invocation, ...otherInvocations] = runtimeReferences(workerSymbol);
  const invokeCall = invocation?.identifier.parent;
  if (
    otherInvocations.length ||
    !isNodeOfType(invokeCall, "CallExpression") ||
    invokeCall.callee !== invocation?.identifier ||
    invokeCall.optional ||
    invokeCall.arguments.length
  )
    return false;
  const invokeRoot =
    isNodeOfType(invokeCall.parent, "UnaryExpression") && invokeCall.parent.operator === "void"
      ? invokeCall.parent
      : invokeCall;
  const invokeStatement = invokeRoot.parent;
  const effectCallback = findEnclosingFunction(worker);
  if (
    !isNodeOfType(invokeStatement, "ExpressionStatement") ||
    (!isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(effectCallback, "FunctionExpression")) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    effectCallback.body.body.some(
      (statement, index) => statement !== [workerStatement, invokeStatement][index],
    ) ||
    workerStatement.parent !== effectCallback.body ||
    invokeStatement.parent !== effectCallback.body
  )
    return false;
  const effect = effectCallback.parent;
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== effectCallback ||
    !isDirectNativeHookCall(effect, "useEffect", scopes) ||
    !isNodeOfType(effect.parent, "ExpressionStatement") ||
    effect.parent.parent !== owner.body
  )
    return false;
  const [, dependencies, ...otherEffectArguments] = effect.arguments;
  if (
    otherEffectArguments.length ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length
  )
    return false;
  let returnedOwnerNode: EsTreeNode = element;
  while (returnedOwnerNode.parent && returnedOwnerNode.parent !== owner.body) {
    returnedOwnerNode = returnedOwnerNode.parent;
  }
  const [
    firstStateStatement,
    secondStateStatement,
    registeredEffectStatement,
    finalOwnerStatement,
    ...otherOwnerStatements
  ] = owner.body.body;
  const pendingStateStatement = pending.declarator.parent;
  const resultStateStatement = result.declarator.parent;
  if (
    otherOwnerStatements.length ||
    !isNodeOfType(returnedOwnerNode, "ReturnStatement") ||
    finalOwnerStatement !== returnedOwnerNode ||
    registeredEffectStatement !== effect.parent ||
    !(
      (firstStateStatement === pendingStateStatement &&
        secondStateStatement === resultStateStatement) ||
      (firstStateStatement === resultStateStatement &&
        secondStateStatement === pendingStateStatement)
    )
  )
    return false;
  const [loadStatement, resultStatement, ...otherTryStatements] = tried.block.body;
  if (
    otherTryStatements.length ||
    !isNodeOfType(loadStatement, "VariableDeclaration") ||
    loadStatement.kind !== "const" ||
    !isNodeOfType(resultStatement, "ExpressionStatement")
  )
    return false;
  const [loaded, ...otherLoadedDeclarations] = loadStatement.declarations;
  const store = stripParenExpression(resultStatement.expression);
  if (
    otherLoadedDeclarations.length ||
    !loaded ||
    !isNodeOfType(loaded.id, "Identifier") ||
    !isNodeOfType(loaded.init, "AwaitExpression") ||
    !isNodeOfType(loaded.init.argument, "CallExpression") ||
    loaded.init.argument.optional ||
    loaded.init.argument.arguments.length ||
    !isNodeOfType(loaded.init.argument.callee, "Identifier") ||
    !isNodeOfType(store, "CallExpression") ||
    store.optional ||
    !isNodeOfType(store.callee, "Identifier") ||
    scopes.symbolFor(store.callee) !== result.setterSymbol
  )
    return false;
  const [stored, ...otherStoredArguments] = store.arguments;
  const loadedSymbol = scopes.symbolFor(loaded.id);
  const task = scopes.symbolFor(loaded.init.argument.callee);
  const taskApi = resolveImportedApiReference(loaded.init.argument.callee, scopes);
  if (
    otherStoredArguments.length ||
    !isNodeOfType(stored, "Identifier") ||
    !loadedSymbol ||
    scopes.symbolFor(stored) !== loadedSymbol ||
    !isSymbolReadOnly(loadedSymbol) ||
    !runtimeReferences(loadedSymbol).every((reference) => reference.identifier === stored) ||
    !runtimeReferences(result.setterSymbol).every(
      (reference) => reference.identifier === store.callee,
    ) ||
    task?.kind !== "import" ||
    !taskApi ||
    taskApi.isNamespace ||
    taskApi.source === "react" ||
    !isSymbolReadOnly(task)
  )
    return false;
  const program = findProgramRoot(element);
  return Boolean(program && !hasProviderUncertainty(program, scopes));
};
