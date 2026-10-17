import {
  OBSERVER_SNAPSHOT_BLOCK_STATEMENT_COUNT,
  OBSERVER_SNAPSHOT_CALLBACK_PARAMETER_LIMIT,
  OBSERVER_SNAPSHOT_CLEANUP_PARAMETER_COUNT,
  OBSERVER_SNAPSHOT_CONSTRUCTOR_ARGUMENT_LIMIT,
  OBSERVER_SNAPSHOT_MAP_PARAMETER_COUNT,
  OBSERVER_SNAPSHOT_SINGLE_STATEMENT_COUNT,
  OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT,
  OBSERVER_SNAPSHOT_UNSUPPORTED_PROPERTIES,
} from "../../../constants/dom.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { doNodesCoverEveryPathAfterNode } from "../../../utils/do-nodes-cover-every-path-after-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { hasClosedObserverSnapshotProviderHazard } from "./has-closed-observer-snapshot-provider-hazard.js";

interface MappedObserverCleanupOptions {
  effectCallback: EsTreeNode;
  construction: EsTreeNode;
  context: RuleContext;
}

const getConstStatementSymbol = (
  statement: EsTreeNode | undefined,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== OBSERVER_SNAPSHOT_SINGLE_STATEMENT_COUNT
  ) {
    return null;
  }
  const [declaration] = statement.declarations;
  if (!declaration || !isNodeOfType(declaration.id, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(declaration.id);
  return symbol?.kind === "const" && getDirectConstInitializer(symbol) ? symbol : null;
};

const referencesMatch = (
  symbol: SymbolDescriptor | null,
  identifiers: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean =>
  Boolean(
    symbol &&
    symbol.references.length === identifiers.length &&
    identifiers.every((identifier) => context.scopes.symbolFor(identifier) === symbol) &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isBindingAssignmentTarget(reference.identifier) &&
        identifiers.includes(reference.identifier),
    ),
  );

const getDirectMemberCall = (
  expression: EsTreeNode | undefined,
  methodName: string,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!expression) return null;
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    candidate.optional ||
    !isNodeOfType(candidate.callee, "MemberExpression") ||
    candidate.callee.computed ||
    candidate.callee.optional ||
    getStaticPropertyName(candidate.callee) !== methodName
  ) {
    return null;
  }
  return candidate;
};

export const doesReturnedCleanupReleaseMappedObserver = ({
  effectCallback,
  construction,
  context,
}: MappedObserverCleanupOptions): boolean => {
  if (
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length !== 0 ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    effectCallback.body.body.length !== OBSERVER_SNAPSHOT_BLOCK_STATEMENT_COUNT
  ) {
    return false;
  }
  const effectRoot = findTransparentExpressionRoot(effectCallback);
  const effectCall = effectRoot.parent;
  if (!isNodeOfType(effectCall, "CallExpression")) return false;
  const [effectArgument] = effectCall.arguments;
  if (effectArgument !== effectRoot) {
    return false;
  }
  const effectCallee = stripParenExpression(effectCall.callee);
  const effectSymbol = isNodeOfType(effectCallee, "Identifier")
    ? context.scopes.symbolFor(effectCallee)
    : null;
  const effectImport = effectSymbol ? getImportDeclarationForSymbol(effectSymbol) : null;
  if (
    !effectSymbol ||
    !effectImport ||
    effectImport.source.value !== "react" ||
    effectImport.importKind === "type" ||
    !isNodeOfType(effectSymbol.declarationNode, "ImportSpecifier") ||
    effectSymbol.declarationNode.importKind === "type" ||
    getImportedName(effectSymbol.declarationNode) !== "useEffect" ||
    effectCall.optional ||
    effectSymbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const call = referenceRoot.parent;
      return (
        reference.flag !== "read" ||
        isBindingAssignmentTarget(reference.identifier) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== referenceRoot ||
        call.optional
      );
    })
  ) {
    return false;
  }
  const [snapshotStatement, observersStatement, cleanupReturn] = effectCallback.body.body;
  const snapshotSymbol = getConstStatementSymbol(snapshotStatement, context);
  const observersSymbol = getConstStatementSymbol(observersStatement, context);
  if (!snapshotSymbol?.initializer || !observersSymbol?.initializer) return false;
  const snapshotCall = getDirectMemberCall(snapshotSymbol.initializer, "from");
  const acquisition = getDirectMemberCall(observersSymbol.initializer, "map");
  if (
    !snapshotCall ||
    !isNodeOfType(snapshotCall.callee, "MemberExpression") ||
    !isNodeOfType(snapshotCall.callee.object, "Identifier") ||
    snapshotCall.callee.object.name !== "Array" ||
    !context.scopes.isGlobalReference(snapshotCall.callee.object) ||
    snapshotCall.arguments.length !== OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT ||
    !acquisition ||
    !isNodeOfType(acquisition.callee, "MemberExpression") ||
    acquisition.arguments.length !== OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT ||
    !isNodeOfType(cleanupReturn, "ReturnStatement") ||
    !cleanupReturn.argument
  ) {
    return false;
  }
  const [snapshotArgument] = snapshotCall.arguments;
  const query = getDirectMemberCall(snapshotArgument, "querySelectorAll");
  const [selector] = query?.arguments ?? [];
  if (
    !query ||
    !isNodeOfType(query.callee, "MemberExpression") ||
    !isNodeOfType(query.callee.object, "Identifier") ||
    query.callee.object.name !== "document" ||
    !context.scopes.isGlobalReference(query.callee.object) ||
    query.arguments.length !== OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT ||
    !isNodeOfType(selector, "Literal") ||
    typeof selector.value !== "string"
  ) {
    return false;
  }
  const [acquisitionCallback] = acquisition.arguments;
  if (
    !isFunctionLike(acquisitionCallback) ||
    acquisitionCallback.async ||
    acquisitionCallback.generator ||
    acquisitionCallback.params.length !== OBSERVER_SNAPSHOT_MAP_PARAMETER_COUNT ||
    !isNodeOfType(acquisitionCallback.body, "BlockStatement") ||
    acquisitionCallback.body.body.length !== OBSERVER_SNAPSHOT_BLOCK_STATEMENT_COUNT
  ) {
    return false;
  }
  const [targetParameter] = acquisitionCallback.params;
  const [observerStatement, observeStatement, observerReturn] = acquisitionCallback.body.body;
  const observerSymbol = getConstStatementSymbol(observerStatement, context);
  const observe = isNodeOfType(observeStatement, "ExpressionStatement")
    ? getDirectMemberCall(observeStatement.expression, "observe")
    : null;
  if (
    !isNodeOfType(targetParameter, "Identifier") ||
    !observerSymbol?.initializer ||
    stripParenExpression(observerSymbol.initializer) !== construction ||
    !isNodeOfType(construction, "NewExpression") ||
    !isNodeOfType(construction.callee, "Identifier") ||
    construction.callee.name !== "IntersectionObserver" ||
    !context.scopes.isGlobalReference(construction.callee) ||
    construction.arguments.length < OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT ||
    construction.arguments.length > OBSERVER_SNAPSHOT_CONSTRUCTOR_ARGUMENT_LIMIT ||
    !observe ||
    !isNodeOfType(observe.callee, "MemberExpression") ||
    observe.arguments.length !== OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT ||
    !isNodeOfType(observerReturn, "ReturnStatement") ||
    !observerReturn.argument
  ) {
    return false;
  }
  const [observerCallback, observerOptions] = construction.arguments;
  if (
    !isFunctionLike(observerCallback) ||
    observerCallback.params.length > OBSERVER_SNAPSHOT_CALLBACK_PARAMETER_LIMIT ||
    observerCallback.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  ) {
    return false;
  }
  if (
    observerOptions &&
    (!isNodeOfType(observerOptions, "ObjectExpression") ||
      !observerOptions.properties.every(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          !property.method &&
          !property.shorthand &&
          property.kind === "init" &&
          !OBSERVER_SNAPSHOT_UNSUPPORTED_PROPERTIES.has(
            getResolvedStaticPropertyName(property, context.scopes) ?? "",
          ) &&
          isNodeOfType(property.value, "Literal") &&
          (property.value.value === null ||
            ["string", "number", "boolean"].includes(typeof property.value.value)),
      ))
  ) {
    return false;
  }
  const cleanup = stripParenExpression(cleanupReturn.argument);
  if (
    !isFunctionLike(cleanup) ||
    cleanup.async ||
    cleanup.generator ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== OBSERVER_SNAPSHOT_SINGLE_STATEMENT_COUNT
  ) {
    return false;
  }
  const [cleanupStatement] = cleanup.body.body;
  const cleanupIterator = isNodeOfType(cleanupStatement, "ExpressionStatement")
    ? getDirectMemberCall(cleanupStatement.expression, "map")
    : null;
  if (
    !cleanupIterator ||
    !isNodeOfType(cleanupIterator.callee, "MemberExpression") ||
    cleanupIterator.arguments.length !== OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT
  ) {
    return false;
  }
  const [cleanupCallback] = cleanupIterator.arguments;
  if (
    !isFunctionLike(cleanupCallback) ||
    cleanupCallback.async ||
    cleanupCallback.generator ||
    cleanupCallback.params.length !== OBSERVER_SNAPSHOT_CLEANUP_PARAMETER_COUNT
  ) {
    return false;
  }
  const [cleanupTarget, cleanupIndex] = cleanupCallback.params;
  let releaseExpression: EsTreeNode = cleanupCallback.body;
  if (isNodeOfType(releaseExpression, "BlockStatement")) {
    const [releaseStatement] = releaseExpression.body;
    if (
      releaseExpression.body.length !== OBSERVER_SNAPSHOT_SINGLE_STATEMENT_COUNT ||
      !isNodeOfType(releaseStatement, "ExpressionStatement")
    ) {
      return false;
    }
    releaseExpression = releaseStatement.expression;
  }
  if (isNodeOfType(releaseExpression, "ChainExpression")) {
    releaseExpression = releaseExpression.expression;
  }
  const release = stripParenExpression(releaseExpression);
  if (
    !isNodeOfType(cleanupTarget, "Identifier") ||
    !isNodeOfType(cleanupIndex, "Identifier") ||
    !isNodeOfType(release, "CallExpression") ||
    release.optional ||
    release.arguments.length !== OBSERVER_SNAPSHOT_UNARY_ARGUMENT_COUNT ||
    !isNodeOfType(release.callee, "MemberExpression") ||
    release.callee.computed ||
    getStaticPropertyName(release.callee) !== "unobserve" ||
    !isNodeOfType(release.callee.object, "MemberExpression")
  ) {
    return false;
  }
  const observerIndex = release.callee.object;
  const [observedTarget] = observe.arguments;
  const [releasedTarget] = release.arguments;
  if (
    !observerIndex.computed ||
    observerIndex.optional ||
    !observedTarget ||
    !releasedTarget ||
    !referencesMatch(
      snapshotSymbol,
      [acquisition.callee.object, cleanupIterator.callee.object],
      context,
    ) ||
    !referencesMatch(observersSymbol, [observerIndex.object], context) ||
    !referencesMatch(observerSymbol, [observe.callee.object, observerReturn.argument], context) ||
    !referencesMatch(context.scopes.symbolFor(targetParameter), [observedTarget], context) ||
    !referencesMatch(context.scopes.symbolFor(cleanupTarget), [releasedTarget], context) ||
    !referencesMatch(context.scopes.symbolFor(cleanupIndex), [observerIndex.property], context)
  ) {
    return false;
  }
  let hasOpaqueCallbackInput = false;
  walkAst(effectCallback.body, (candidate) => {
    if (
      isNodeOfType(candidate, "ThisExpression") ||
      (isNodeOfType(candidate, "Identifier") && candidate.name === "arguments") ||
      (isNodeOfType(candidate, "FunctionExpression") && candidate.id)
    ) {
      hasOpaqueCallbackInput = true;
    }
  });
  return (
    !hasOpaqueCallbackInput &&
    !hasClosedObserverSnapshotProviderHazard({ context, observerIndex }) &&
    doNodesCoverEveryPathAfterNode(acquisition, [cleanupReturn], context)
  );
};
