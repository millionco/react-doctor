import {
  MEMO_TUPLE_ARGUMENT_COUNT,
  MEMO_TUPLE_GLOBAL_CAPABILITY_NAMES,
  MEMO_TUPLE_LOADER_SOURCES,
  REACT_PROVIDER_MUTATION_CAPABILITY_NAMES,
} from "../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { walkAst } from "./walk-ast.js";

interface MemoizedTupleBindingOptions {
  readonly symbol: SymbolDescriptor;
  readonly declarator: EsTreeNodeOfType<"VariableDeclarator">;
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly scopes: ScopeAnalysis;
}

export const isStableMemoizedTupleBinding = ({
  symbol,
  declarator,
  call,
  scopes,
}: MemoizedTupleBindingOptions): boolean => {
  if (
    symbol.kind !== "const" ||
    hasSymbolBindingWrites(symbol) ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.some((element) => !isNodeOfType(element, "Identifier")) ||
    call.optional ||
    call.arguments.length !== MEMO_TUPLE_ARGUMENT_COUNT ||
    !isProvenUnmodifiedReactApiCall(call, "useMemo", scopes) ||
    hasReactDefaultProviderMutation("useMemo", scopes) ||
    !symbol.references.every((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const invocation = referenceRoot.parent;
      return (
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === referenceRoot &&
        !invocation.optional
      );
    })
  )
    return false;
  const pattern = declarator.id;
  const selectedIndex = pattern.elements.findIndex(
    (element) => element === symbol.bindingIdentifier,
  );
  const [factoryArgument] = call.arguments;
  if (selectedIndex < 0 || !isNodeOfType(factoryArgument, "Identifier")) return false;
  const factorySymbol = scopes.symbolFor(factoryArgument);
  const factory = factorySymbol ? getDirectConstInitializer(factorySymbol) : null;
  if (
    !factorySymbol ||
    factorySymbol.scope.kind !== "module" ||
    hasSymbolBindingWrites(factorySymbol) ||
    !hasCompleteSymbolReferences(factorySymbol, scopes.rootScope.node, scopes) ||
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.length !== 0 ||
    !factorySymbol.references.every(
      (reference) => findTransparentExpressionRoot(reference.identifier) === factoryArgument,
    )
  )
    return false;
  const returns = collectFunctionReturnStatements(factory);
  if (
    isNodeOfType(factory.body, "BlockStatement") &&
    (returns.length === 0 || factory.body.body.at(-1) !== returns.at(-1))
  )
    return false;
  const returnedValues = isNodeOfType(factory.body, "BlockStatement")
    ? returns.map((returned) => returned.argument)
    : [factory.body];
  if (
    !returnedValues.every((value) => {
      if (
        !isNodeOfType(value, "ArrayExpression") ||
        value.elements.length !== pattern.elements.length ||
        value.elements.some((element) => !element || isNodeOfType(element, "SpreadElement"))
      )
        return false;
      const selectedValue = value.elements[selectedIndex];
      if (isNodeOfType(selectedValue, "ArrowFunctionExpression")) return true;
      if (!isNodeOfType(selectedValue, "Identifier")) return false;
      const selectedSymbol = scopes.symbolFor(selectedValue);
      const selectedInitializer = selectedSymbol ? getDirectConstInitializer(selectedSymbol) : null;
      return Boolean(
        selectedSymbol &&
        !hasSymbolBindingWrites(selectedSymbol) &&
        hasCompleteSymbolReferences(selectedSymbol, scopes.rootScope.node, scopes) &&
        isAstDescendant(selectedSymbol.declarationNode, factory.body) &&
        selectedSymbol.declarationNode.range[1] < selectedValue.range[0] &&
        isNodeOfType(selectedInitializer, "ArrowFunctionExpression"),
      );
    })
  )
    return false;
  let hasCapability = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasCapability) return false;
    if (isTypeScriptTypePosition(node)) return false;
    const dependency = getRuntimeStaticDependencySource(node);
    if (
      (dependency !== null && MEMO_TUPLE_LOADER_SOURCES.has(dependency)) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSParameterProperty")
    ) {
      hasCapability = true;
      return false;
    }
    for (const name of MEMO_TUPLE_GLOBAL_CAPABILITY_NAMES) {
      if (isProvenGlobalNamespaceReference(node, name, scopes)) {
        hasCapability = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "Identifier") &&
      MEMO_TUPLE_GLOBAL_CAPABILITY_NAMES.has(node.name) &&
      scopes.referenceFor(node)
    ) {
      const binding = scopes.symbolFor(node);
      if (binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding))
        hasCapability = true;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes);
      if (
        (node.computed && propertyName === null) ||
        (isNodeOfType(node, "MemberExpression") &&
          isProvenGlobalObjectReference(node.object, scopes) &&
          propertyName !== null &&
          MEMO_TUPLE_GLOBAL_CAPABILITY_NAMES.has(propertyName)) ||
        propertyName === "constructor" ||
        (propertyName !== null && REACT_PROVIDER_MUTATION_CAPABILITY_NAMES.has(propertyName))
      )
        hasCapability = true;
    }
  });
  return !hasCapability;
};
