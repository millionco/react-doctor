import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getImportedName } from "./get-imported-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasDynamicScopeAccess } from "./has-dynamic-scope-access.js";
import { hasLexicalReceiverReference } from "./has-lexical-receiver-reference.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface ConfiguredHookForwardingCandidate {
  readonly innerCall: EsTreeNodeOfType<"CallExpression">;
  readonly callers: ReadonlySet<EsTreeNodeOfType<"CallExpression">>;
}

export const collectConfiguredHookForwardingCandidates = (
  scopes: ScopeAnalysis,
  additionalHooks: RegExp | null,
): ConfiguredHookForwardingCandidate[] => {
  const candidates: ConfiguredHookForwardingCandidate[] = [];
  const program = scopes.rootScope.node;
  if (
    !additionalHooks ||
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    hasDynamicScopeAccess(scopes)
  )
    return candidates;

  for (const symbol of scopes.rootScope.symbols) {
    const wrapper = symbol.initializer;
    const declaration = symbol.declarationNode;
    if (
      symbol.kind !== "const" ||
      !additionalHooks.test(symbol.name) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== symbol.bindingIdentifier ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.parent !== program ||
      !isNodeOfType(wrapper, "ArrowFunctionExpression") ||
      wrapper.async ||
      getFunctionExportNames(program, wrapper).length > 0 ||
      hasSymbolBindingWrites(symbol) ||
      !hasCompleteSymbolReferences(symbol, program, scopes) ||
      hasLexicalReceiverReference(wrapper, scopes)
    )
      continue;

    const [callbackParameter, dependenciesParameter, ...extraParameters] = wrapper.params;
    if (
      !isNodeOfType(callbackParameter, "Identifier") ||
      !isNodeOfType(dependenciesParameter, "Identifier") ||
      callbackParameter === dependenciesParameter ||
      callbackParameter.name === dependenciesParameter.name ||
      callbackParameter.name === "this" ||
      dependenciesParameter.name === "this" ||
      extraParameters.length > 0
    )
      continue;

    const onlyStatement = isNodeOfType(wrapper.body, "BlockStatement")
      ? wrapper.body.body[0]
      : null;
    const innerCall =
      isNodeOfType(wrapper.body, "BlockStatement") &&
      wrapper.body.body.length === 1 &&
      isNodeOfType(onlyStatement, "ExpressionStatement")
        ? onlyStatement.expression
        : getSingleReturnExpression(wrapper);
    if (
      !isNodeOfType(innerCall, "CallExpression") ||
      innerCall.optional ||
      !isNodeOfType(innerCall.callee, "Identifier")
    )
      continue;

    const effectSymbol = scopes.symbolFor(innerCall.callee);
    const importedName = effectSymbol ? getImportedName(effectSymbol.declarationNode) : null;
    if (
      !effectSymbol ||
      getValueImportSource(effectSymbol) !== "react" ||
      (importedName !== "useEffect" && importedName !== "useLayoutEffect") ||
      innerCall.callee.name !== importedName ||
      hasSymbolBindingWrites(effectSymbol) ||
      !hasCompleteSymbolReferences(effectSymbol, program, scopes)
    )
      continue;

    const [forwardedCallback, forwardedDependencies, ...extraForwardedArguments] =
      innerCall.arguments;
    const callbackSymbol = scopes.symbolFor(callbackParameter);
    const dependenciesSymbol = scopes.symbolFor(dependenciesParameter);
    if (
      !isNodeOfType(forwardedCallback, "Identifier") ||
      !isNodeOfType(forwardedDependencies, "Identifier") ||
      extraForwardedArguments.length > 0 ||
      !callbackSymbol ||
      !dependenciesSymbol ||
      callbackSymbol.kind !== "parameter" ||
      dependenciesSymbol.kind !== "parameter" ||
      scopes.symbolFor(forwardedCallback) !== callbackSymbol ||
      scopes.symbolFor(forwardedDependencies) !== dependenciesSymbol ||
      callbackSymbol.references.length !== 1 ||
      dependenciesSymbol.references.length !== 1 ||
      callbackSymbol.references[0]?.identifier !== forwardedCallback ||
      dependenciesSymbol.references[0]?.identifier !== forwardedDependencies ||
      hasSymbolBindingWrites(callbackSymbol) ||
      hasSymbolBindingWrites(dependenciesSymbol) ||
      !hasCompleteSymbolReferences(callbackSymbol, program, scopes) ||
      !hasCompleteSymbolReferences(dependenciesSymbol, program, scopes)
    )
      continue;

    const callers = new Set<EsTreeNodeOfType<"CallExpression">>();
    let areAllCallersSupported = true;
    for (const reference of symbol.references) {
      const caller = reference.identifier.parent;
      if (
        !isNodeOfType(caller, "CallExpression") ||
        caller.optional ||
        caller.callee !== reference.identifier
      ) {
        areAllCallersSupported = false;
        break;
      }
      const [callback, dependencies, ...extraArguments] = caller.arguments;
      if (
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression")) ||
        callback.async ||
        (isNodeOfType(callback, "FunctionExpression") && callback.generator) ||
        !isNodeOfType(dependencies, "ArrayExpression") ||
        extraArguments.length > 0
      ) {
        areAllCallersSupported = false;
        break;
      }
      callers.add(caller);
    }
    if (areAllCallersSupported && callers.size > 0) candidates.push({ innerCall, callers });
  }
  return candidates;
};
