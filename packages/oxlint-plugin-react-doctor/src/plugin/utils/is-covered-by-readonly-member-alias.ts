import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getUninterruptedConstInitializer } from "./get-uninterrupted-const-initializer.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasDynamicScopeAccess } from "./has-dynamic-scope-access.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isComponentFunction } from "./is-component-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";

interface MemberAliasProviderFacts {
  readonly providerProofs: Map<SymbolDescriptor, boolean>;
  hasDefaultProviderMutation?: boolean;
}

const providerFactsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, MemberAliasProviderFacts>
>();

interface ReadonlyMemberAliasCoverageInput {
  readonly hookCall: EsTreeNode;
  readonly callback: EsTreeNode;
  readonly dependencies: EsTreeNode;
  readonly missingKey: string;
  readonly rootReference: ReferenceDescriptor;
  readonly admittedKeys: ReadonlySet<string> | null;
  readonly context: RuleContext;
}

export const isCoveredByReadonlyMemberAlias = ({
  hookCall,
  callback,
  dependencies,
  missingKey,
  rootReference,
  admittedKeys,
  context,
}: ReadonlyMemberAliasCoverageInput): boolean => {
  const scopes = context.scopes;
  const program = scopes.rootScope.node;
  if (
    !admittedKeys ||
    admittedKeys.size !== 1 ||
    !admittedKeys.has(missingKey) ||
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !isNodeOfType(hookCall, "CallExpression") ||
    hookCall.optional ||
    hookCall.arguments.length !== 2 ||
    hookCall.arguments[0] !== callback ||
    hookCall.arguments[1] !== dependencies ||
    !isNodeOfType(hookCall.callee, "Identifier") ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== 0 ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 1 ||
    hasDynamicScopeAccess(scopes)
  )
    return false;
  const provider = scopes.symbolFor(hookCall.callee);
  if (
    !provider ||
    !isNodeOfType(provider.declarationNode, "ImportSpecifier") ||
    !isNodeOfType(provider.declarationNode.imported, "Identifier") ||
    provider.declarationNode.imported.name !== "useMemo" ||
    getValueImportSource(provider) !== "react" ||
    !hasCompleteSymbolReferences(provider, program, scopes)
  )
    return false;
  let factsByProgram = providerFactsByScopes.get(scopes);
  if (!factsByProgram) {
    factsByProgram = new WeakMap();
    providerFactsByScopes.set(scopes, factsByProgram);
  }
  let providerFacts = factsByProgram.get(program);
  if (!providerFacts) {
    providerFacts = { providerProofs: new Map() };
    factsByProgram.set(program, providerFacts);
  }
  let isProviderUnmodified = providerFacts.providerProofs.get(provider);
  if (isProviderUnmodified === undefined) {
    isProviderUnmodified = isProvenUnmodifiedReactApiCall(hookCall, "useMemo", scopes);
    providerFacts.providerProofs.set(provider, isProviderUnmodified);
  }
  if (!isProviderUnmodified) return false;
  providerFacts.hasDefaultProviderMutation ??= hasReactDefaultProviderMutation("useMemo", scopes);
  if (providerFacts.hasDefaultProviderMutation) return false;
  const dependency = dependencies.elements[0];
  if (!isNodeOfType(dependency, "Identifier")) return false;
  const alias = scopes.symbolFor(dependency);
  const snapshot = getUninterruptedConstInitializer(dependency, context);
  if (
    !alias ||
    !isNodeOfType(alias.declarationNode, "VariableDeclarator") ||
    alias.declarationNode.id !== alias.bindingIdentifier ||
    !isNodeOfType(snapshot, "MemberExpression") ||
    snapshot.computed ||
    snapshot.optional ||
    !isNodeOfType(snapshot.object, "Identifier") ||
    !isNodeOfType(snapshot.property, "Identifier") ||
    alias.references.length !== 1 ||
    alias.references[0].identifier !== dependency ||
    alias.references[0].flag !== "read" ||
    hasSymbolBindingWrites(alias) ||
    !hasCompleteSymbolReferences(alias, program, scopes)
  )
    return false;
  const root = scopes.symbolFor(snapshot.object);
  const argument = rootReference.identifier;
  const helperCall = argument.parent;
  if (
    !root ||
    root.kind !== "parameter" ||
    rootReference.resolvedSymbol !== root ||
    !isNodeOfType(argument, "Identifier") ||
    rootReference.flag !== "read" ||
    !isNodeOfType(helperCall, "CallExpression") ||
    helperCall.optional ||
    helperCall.arguments.length !== 1 ||
    helperCall.arguments[0] !== argument ||
    !isNodeOfType(helperCall.callee, "Identifier") ||
    getSingleReturnExpression(callback) !== helperCall ||
    missingKey !== `${snapshot.object.name}.${snapshot.property.name}` ||
    root.references.length !== 2 ||
    hasSymbolBindingWrites(root) ||
    !hasCompleteSymbolReferences(root, program, scopes) ||
    root.references.some(
      (reference) =>
        reference.flag !== "read" ||
        (reference.identifier !== snapshot.object && reference.identifier !== argument),
    )
  )
    return false;
  const hookDeclarator = hookCall.parent;
  const hookDeclaration = hookDeclarator?.parent;
  const aliasDeclaration = alias.declarationNode.parent;
  const block = hookDeclaration?.parent;
  const owner = block?.parent;
  if (
    !isNodeOfType(hookDeclarator, "VariableDeclarator") ||
    hookDeclarator.init !== hookCall ||
    !isNodeOfType(hookDeclarator.id, "Identifier") ||
    !isNodeOfType(hookDeclaration, "VariableDeclaration") ||
    hookDeclaration.kind !== "const" ||
    hookDeclaration.declarations.length !== 1 ||
    !isNodeOfType(aliasDeclaration, "VariableDeclaration") ||
    aliasDeclaration.kind !== "const" ||
    aliasDeclaration.declarations.length !== 1 ||
    aliasDeclaration.parent !== block ||
    !isNodeOfType(block, "BlockStatement") ||
    !isFunctionLike(owner) ||
    owner.body !== block ||
    owner.async ||
    owner.generator ||
    !isComponentFunction(owner) ||
    (isNodeOfType(owner, "FunctionExpression") && owner.id !== null) ||
    owner.params.length !== 1 ||
    !isNodeOfType(owner.params[0], "ObjectPattern") ||
    block.body.findIndex((statement) => statement === hookDeclaration) !==
      block.body.findIndex((statement) => statement === aliasDeclaration) + 1
  )
    return false;
  const prop = root.bindingIdentifier.parent;
  if (
    !isNodeOfType(prop, "Property") ||
    prop.value !== root.bindingIdentifier ||
    prop.computed ||
    prop.kind !== "init" ||
    prop.parent !== owner.params[0]
  )
    return false;
  const ownerDeclarator = owner.parent;
  const ownerDeclaration = isNodeOfType(owner, "FunctionDeclaration")
    ? owner
    : ownerDeclarator?.parent;
  if (
    !isNodeOfType(owner, "FunctionDeclaration") &&
    (!isNodeOfType(ownerDeclarator, "VariableDeclarator") ||
      ownerDeclarator.init !== owner ||
      !isNodeOfType(ownerDeclaration, "VariableDeclaration") ||
      ownerDeclaration.kind !== "const" ||
      ownerDeclaration.declarations.length !== 1)
  )
    return false;
  const ownerStatement = isNodeOfType(ownerDeclaration?.parent, "ExportNamedDeclaration")
    ? ownerDeclaration.parent
    : ownerDeclaration;
  const ownerSymbols = getFunctionBindingSymbols(owner, scopes);
  if (
    ownerStatement?.parent !== program ||
    ownerSymbols.length === 0 ||
    ownerSymbols.some(
      (symbol) =>
        hasSymbolBindingWrites(symbol) ||
        !hasCompleteSymbolReferences(symbol, program, scopes) ||
        symbol.references.some((reference) => {
          const specifier = reference.identifier.parent;
          return (
            reference.flag !== "read" ||
            !isNodeOfType(specifier, "ExportSpecifier") ||
            specifier.local !== reference.identifier ||
            !isNodeOfType(specifier.parent, "ExportNamedDeclaration") ||
            specifier.parent.source !== null
          );
        }),
    )
  )
    return false;
  const helper = scopes.symbolFor(helperCall.callee);
  const helperFunction = helper?.kind === "function" ? helper.declarationNode : helper?.initializer;
  const helperDeclaration =
    helper?.kind === "const" ? helper.declarationNode.parent : helperFunction;
  if (
    !helper ||
    (helper.kind !== "const" && helper.kind !== "function") ||
    helper.scope !== scopes.rootScope ||
    helperDeclaration?.parent !== program ||
    !isFunctionLike(helperFunction) ||
    helperFunction.async ||
    helperFunction.generator ||
    helperFunction.params.length !== 1 ||
    !isNodeOfType(helperFunction.params[0], "Identifier") ||
    helper.references.length !== 1 ||
    helper.references[0].identifier !== helperCall.callee ||
    helper.references[0].flag !== "read" ||
    hasSymbolBindingWrites(helper) ||
    !hasCompleteSymbolReferences(helper, program, scopes)
  )
    return false;
  const selection = getSingleReturnExpression(helperFunction);
  const parameter = scopes.symbolFor(helperFunction.params[0]);
  return Boolean(
    isNodeOfType(selection, "MemberExpression") &&
    !selection.computed &&
    !selection.optional &&
    isNodeOfType(selection.object, "Identifier") &&
    isNodeOfType(selection.property, "Identifier") &&
    selection.property.name === snapshot.property.name &&
    parameter &&
    scopes.symbolFor(selection.object) === parameter &&
    parameter.references.length === 1 &&
    parameter.references[0].identifier === selection.object &&
    parameter.references[0].flag === "read" &&
    !hasSymbolBindingWrites(parameter) &&
    hasCompleteSymbolReferences(parameter, program, scopes),
  );
};
