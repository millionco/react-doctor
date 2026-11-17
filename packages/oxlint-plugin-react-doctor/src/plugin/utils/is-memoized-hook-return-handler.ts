import { GLOBAL_RELEASE_METHOD_NAMES, SUBSCRIPTION_METHOD_NAMES } from "../constants/react.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "./component-or-hook-display-name.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getImportedName } from "./get-imported-name.js";
import { getReactUseCallbackCall } from "./get-react-use-callback-call.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isInlineFunctionExpression } from "./is-inline-function-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface MemoizedHookReturnHandlerInput {
  handler: EsTreeNodeOfType<"Identifier">;
  dependency: EsTreeNodeOfType<"Identifier">;
  effect: EsTreeNodeOfType<"CallExpression">;
  scopes: ScopeAnalysis;
}

const providerUncertaintyByScopes = new WeakMap<ScopeAnalysis, boolean>();
const CODE_LOADING_GLOBAL_NAMES = ["eval", "Function", "require", "module", "process", "Reflect"];
const CODE_LOADING_MEMBER_NAMES = new Set([
  "eval",
  "Function",
  "constructor",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getPrototypeOf",
  "require",
  "createRequire",
  "getBuiltinModule",
  "_load",
  "_compile",
  "compileFunction",
  "runInContext",
  "runInNewContext",
  "runInThisContext",
  "Script",
  "SourceTextModule",
  "SyntheticModule",
]);
const CODE_LOADING_MODULE_SOURCES = new Set([
  "module",
  "node:module",
  "process",
  "node:process",
  "vm",
  "node:vm",
  "inspector",
  "node:inspector",
]);

const hasProviderUncertainty = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const cached = providerUncertaintyByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let uncertain = false;
  walkAst(program, (node) => {
    if (uncertain) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "ImportDeclaration") && isTypeOnlyImport(node)) ||
      (isNodeOfType(node, "ImportSpecifier") && node.importKind === "type") ||
      (isNodeOfType(node, "TSImportEqualsDeclaration") && node.importKind === "type") ||
      ((isNodeOfType(node, "TSEnumDeclaration") ||
        isNodeOfType(node, "TSModuleDeclaration") ||
        isNodeOfType(node, "ClassDeclaration")) &&
        node.declare)
    )
      return false;
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression")) {
      uncertain = true;
    } else if (
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSParameterProperty")
    ) {
      uncertain = true;
    } else if (isNodeOfType(node, "ImportDeclaration")) {
      const source = node.source.value;
      uncertain =
        CODE_LOADING_MODULE_SOURCES.has(source) ||
        source.startsWith("react/") ||
        (source === "react" &&
          (!node.specifiers.length ||
            node.specifiers.some(
              (specifier) =>
                !isNodeOfType(specifier, "ImportSpecifier") ||
                getImportedName(specifier)?.startsWith("__"),
            )));
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      uncertain =
        isNodeOfType(callee, "Identifier") && (callee.name === "eval" || callee.name === "require");
    } else if (isNodeOfType(node, "Identifier") && scopes.referenceFor(node)) {
      const symbol = scopes.symbolFor(node);
      const bindingProperty =
        symbol && getDestructuredBindingPropertyName(symbol.bindingIdentifier);
      uncertain =
        node.name === "eval" ||
        node.name === "require" ||
        CODE_LOADING_GLOBAL_NAMES.some((name) =>
          isProvenGlobalNamespaceReference(node, name, scopes),
        ) ||
        Boolean(bindingProperty && CODE_LOADING_MEMBER_NAMES.has(bindingProperty));
    } else if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      uncertain =
        name === null ||
        name === "useCallback" ||
        CODE_LOADING_MEMBER_NAMES.has(name) ||
        Boolean(name?.startsWith("__"));
    }
  });
  providerUncertaintyByScopes.set(scopes, uncertain);
  return uncertain;
};

const isListenerReference = (identifier: EsTreeNode, effectCallback: EsTreeNode): boolean => {
  const call = identifier.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const [, handlerArgument] = call.arguments;
  if (handlerArgument !== identifier || !isNodeOfType(call.callee, "MemberExpression"))
    return false;
  const method = getStaticPropertyName(call.callee);
  if (
    !method ||
    (!SUBSCRIPTION_METHOD_NAMES.has(method) && !GLOBAL_RELEASE_METHOD_NAMES.has(method))
  ) {
    return false;
  }
  const statement = call.parent;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const block = statement.parent;
  if (
    !isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(effectCallback, "FunctionExpression")
  )
    return false;
  if (block === effectCallback.body) return true;
  const cleanup = block?.parent;
  return Boolean(
    isInlineFunctionExpression(cleanup) &&
    cleanup.body === block &&
    isNodeOfType(cleanup.parent, "ReturnStatement") &&
    cleanup.parent.parent === effectCallback.body,
  );
};

export const isMemoizedHookReturnHandler = ({
  handler,
  dependency,
  effect,
  scopes,
}: MemoizedHookReturnHandlerInput): boolean => {
  const consumer = scopes.symbolFor(handler);
  if (
    !consumer ||
    scopes.symbolFor(dependency) !== consumer ||
    consumer.kind !== "const" ||
    !isSymbolReadOnly(consumer) ||
    !isNodeOfType(consumer.declarationNode, "VariableDeclarator")
  )
    return false;
  const declaration = consumer.declarationNode;
  if (
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration")
  )
    return false;
  const [consumerDeclaration, ...otherConsumerDeclarations] = declaration.parent.declarations;
  if (consumerDeclaration !== declaration || otherConsumerDeclarations.length) return false;
  const [field, ...otherFields] = declaration.id.properties;
  if (
    otherFields.length ||
    !isNodeOfType(field, "Property") ||
    field.computed ||
    field.kind !== "init" ||
    !isNodeOfType(field.key, "Identifier") ||
    field.key.name === "__proto__" ||
    field.value !== consumer.bindingIdentifier ||
    !isNodeOfType(field.value, "Identifier")
  )
    return false;
  const call = declaration.init && stripParenExpression(declaration.init);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const owner = findEnclosingFunction(call);
  if (
    !isInlineFunctionExpression(owner) ||
    !componentOrHookDisplayNameForFunction(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    findEnclosingFunction(effect) !== owner
  )
    return false;
  const [firstOwnerStatement] = owner.body.body;
  if (declaration.parent !== firstOwnerStatement) return false;
  const ownerDeclaration = owner.parent;
  if (
    !isNodeOfType(ownerDeclaration, "VariableDeclarator") ||
    ownerDeclaration.init !== owner ||
    !isNodeOfType(ownerDeclaration.parent, "VariableDeclaration") ||
    ownerDeclaration.parent.kind !== "const" ||
    !isNodeOfType(ownerDeclaration.parent.parent, "Program")
  )
    return false;
  const effectCallback = getEffectCallback(effect);
  if (
    !effectCallback ||
    !consumer.references.every(
      (reference) =>
        (field.shorthand && reference.identifier === field.key) ||
        reference.identifier === dependency ||
        isListenerReference(reference.identifier, effectCallback),
    )
  )
    return false;
  const provider = scopes.symbolFor(call.callee);
  const providerInitializer = provider && getDirectConstInitializer(provider);
  if (
    !provider ||
    !providerInitializer ||
    !isSymbolReadOnly(provider) ||
    !isReactHookName(provider.name) ||
    !isNodeOfType(providerInitializer, "ArrowFunctionExpression") ||
    providerInitializer.async ||
    providerInitializer.generator ||
    providerInitializer.params.length ||
    !isNodeOfType(providerInitializer.body, "BlockStatement") ||
    !isNodeOfType(provider.declarationNode.parent, "VariableDeclaration") ||
    !isNodeOfType(provider.declarationNode.parent.parent, "Program")
  )
    return false;
  const [providerReference, ...otherProviderReferences] = provider.references;
  if (otherProviderReferences.length || providerReference?.identifier !== call.callee) return false;
  const program = findProgramRoot(effect);
  if (!program || hasProviderUncertainty(program, scopes)) return false;
  let exported = false;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "ExportSpecifier") &&
      isNodeOfType(node.local, "Identifier") &&
      node.local.name === provider.name
    )
      exported = true;
    if (
      isNodeOfType(node, "ExportDefaultDeclaration") &&
      isNodeOfType(node.declaration, "Identifier") &&
      node.declaration.name === provider.name
    )
      exported = true;
  });
  if (exported) return false;
  const [memoStatement, returnStatement, ...otherStatements] = providerInitializer.body.body;
  if (
    otherStatements.length ||
    !isNodeOfType(memoStatement, "VariableDeclaration") ||
    memoStatement.kind !== "const" ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !isNodeOfType(returnStatement.argument, "ObjectExpression")
  )
    return false;
  const [memoDeclaration, ...otherMemoDeclarations] = memoStatement.declarations;
  const [returnedField, ...otherReturnedFields] = returnStatement.argument.properties;
  if (
    otherMemoDeclarations.length ||
    !memoDeclaration ||
    !isNodeOfType(memoDeclaration.id, "Identifier") ||
    otherReturnedFields.length ||
    !isNodeOfType(returnedField, "Property") ||
    returnedField.computed ||
    returnedField.method ||
    returnedField.kind !== "init" ||
    !isNodeOfType(returnedField.key, "Identifier") ||
    returnedField.key.name !== field.key.name ||
    !isNodeOfType(returnedField.value, "Identifier")
  )
    return false;
  const memo = scopes.symbolFor(memoDeclaration.id);
  if (
    !memo ||
    scopes.symbolFor(returnedField.value) !== memo ||
    !getDirectConstInitializer(memo) ||
    !isSymbolReadOnly(memo) ||
    !memo.references.every(
      (reference) =>
        reference.identifier === returnedField.value ||
        (returnedField.shorthand && reference.identifier === returnedField.key),
    )
  )
    return false;
  const memoCall = getReactUseCallbackCall(returnedField.value, scopes);
  if (
    !memoCall ||
    memoCall.optional ||
    !isNodeOfType(memoCall.callee, "Identifier") ||
    !memoDeclaration.init ||
    stripParenExpression(memoDeclaration.init) !== memoCall
  )
    return false;
  const [callback, dependencies, ...otherArguments] = memoCall.arguments;
  if (
    otherArguments.length ||
    !isInlineFunctionExpression(callback) ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length
  )
    return false;
  const native = scopes.symbolFor(memoCall.callee);
  const nativeDeclaration = native?.declarationNode;
  const nativeImport = nativeDeclaration?.parent;
  return Boolean(
    native &&
    isSymbolReadOnly(native) &&
    isNodeOfType(nativeDeclaration, "ImportSpecifier") &&
    nativeDeclaration.importKind !== "type" &&
    getImportedName(nativeDeclaration) === "useCallback" &&
    isNodeOfType(nativeImport, "ImportDeclaration") &&
    nativeImport.source.value === "react" &&
    !isTypeOnlyImport(nativeImport) &&
    native.references.every(
      (reference) =>
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        reference.identifier.parent.callee === reference.identifier,
    ),
  );
};
