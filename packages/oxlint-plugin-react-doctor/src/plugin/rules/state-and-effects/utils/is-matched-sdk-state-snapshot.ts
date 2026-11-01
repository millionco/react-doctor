import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findVisibleSymbol } from "../../../utils/find-visible-symbol.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { EffectStateWriteFact } from "./collect-effect-state-write-facts.js";
import { hasSupportedTwilioVideoSnapshotApi } from "./has-supported-twilio-video-snapshot-api.js";
import {
  SDK_SNAPSHOT_UNSUPPORTED_IDENTIFIERS,
  SDK_SNAPSHOT_UNSUPPORTED_MEMBERS,
  SDK_SNAPSHOT_RUNTIME_TYPESCRIPT_NODES,
} from "./constants.js";

interface MatchedSdkStateSnapshotInput {
  readonly context: RuleContext;
  readonly effectCall: EsTreeNode;
  readonly fact: EffectStateWriteFact;
}

const hasReadonlyReferences = (symbol: SymbolDescriptor): boolean =>
  getRuntimeSymbolReferences(symbol).every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );

const hasOnlySelectedReferences = (
  symbol: SymbolDescriptor,
  identifiers: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean =>
  hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes) &&
  hasReadonlyReferences(symbol) &&
  getRuntimeSymbolReferences(symbol).length === identifiers.length &&
  getRuntimeSymbolReferences(symbol).every((reference) =>
    identifiers.includes(reference.identifier),
  );

const isReadonlyNamedReactCall = (
  node: EsTreeNode,
  importedName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node.callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === importedName &&
    hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes) &&
    hasReadonlyReferences(symbol) &&
    getRuntimeSymbolReferences(symbol).every(
      (reference) =>
        isNodeOfType(reference.identifier.parent, "CallExpression") &&
        !reference.identifier.parent.optional &&
        reference.identifier.parent.callee === reference.identifier,
    ),
  );
};

const getOrdinaryCallbackCall = (node: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    (!isNodeOfType(node, "ArrowFunctionExpression") && !isNodeOfType(node, "FunctionExpression")) ||
    node.async ||
    node.generator
  )
    return null;
  let expression = node.body;
  if (isNodeOfType(expression, "BlockStatement")) {
    const [statement, ...additionalStatements] = expression.body;
    if (additionalStatements.length !== 0) return null;
    if (isNodeOfType(statement, "ExpressionStatement")) expression = statement.expression;
    else if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      expression = statement.argument;
    } else return null;
  }
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};

const getSnapshotReceiver = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  const expression = stripParenExpression(node);
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    expression.optional ||
    expression.computed ||
    !isNodeOfType(expression.object, "Identifier") ||
    !isNodeOfType(expression.property, "Identifier") ||
    expression.property.name !== "networkQualityLevel"
  )
    return null;
  return expression.object;
};

const getListenerReceiver = (
  node: EsTreeNode,
  method: string,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
  const member = node.callee;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    !isNodeOfType(member.object, "Identifier") ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== method
  )
    return null;
  const [event, callback, ...additionalArguments] = node.arguments;
  if (
    !isNodeOfType(event, "Literal") ||
    event.value !== "networkQualityLevelChanged" ||
    !isNodeOfType(callback, "Identifier") ||
    additionalArguments.length !== 0
  )
    return null;
  return member.object;
};

const hasParticipantTypeRole = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const annotation = getSymbolTypeAnnotation(symbol);
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    annotation.typeArguments ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    hasEnclosingTypeParameterNamed(symbol.bindingIdentifier, annotation.typeName.name)
  )
    return false;
  const importedTypeSymbol = findVisibleSymbol(annotation.typeName, context.scopes);
  if (
    !importedTypeSymbol ||
    getImportDeclarationForSymbol(importedTypeSymbol)?.source.value !== "twilio-video" ||
    getImportedName(importedTypeSymbol.declarationNode) !== "Participant" ||
    !hasOnlySelectedReferences(importedTypeSymbol, [], context)
  )
    return false;
  let hasTypeCollision = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (
      (isNodeOfType(node, "TSTypeAliasDeclaration") ||
        isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression") ||
        isNodeOfType(node, "TSEnumDeclaration") ||
        isNodeOfType(node, "TSModuleDeclaration")) &&
      isNodeOfType(node.id, "Identifier") &&
      node.id.name === importedTypeSymbol.name
    )
      hasTypeCollision = true;
  });
  return !hasTypeCollision;
};

const hasOrdinarySdkSnapshotProviders = (context: RuleContext): boolean => {
  let supported = true;
  const program = context.scopes.rootScope.node;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      SDK_SNAPSHOT_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      ("declare" in node && node.declare === true) ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "JSXElement") ||
      isNodeOfType(node, "JSXFragment")
    ) {
      supported = false;
      return false;
    }
    if (isKeyedDraftTypeReference(node)) return false;
    const parent = node.parent;
    if (
      parent &&
      "key" in parent &&
      parent.key === node &&
      "computed" in parent &&
      !parent.computed &&
      (isNodeOfType(parent, "Property")
        ? !parent.shorthand || parent.value !== node
        : isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "AccessorProperty"))
    )
      return false;

    if (isNodeOfType(node, "Identifier") && SDK_SNAPSHOT_UNSUPPORTED_IDENTIFIERS.has(node.name)) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "MemberExpression") &&
        (SDK_SNAPSHOT_UNSUPPORTED_MEMBERS.has(getStaticPropertyName(node) ?? "") ||
          (node.computed &&
            getStaticPropertyName(node) === null &&
            !(
              isNodeOfType(node.property, "Literal") && typeof node.property.value === "number"
            )))) ||
      (isNodeOfType(node, "Property") &&
        (((isNodeOfType(node.parent, "ObjectPattern") || node.computed || node.shorthand) &&
          SDK_SNAPSHOT_UNSUPPORTED_MEMBERS.has(getStaticKeyName(node.key) ?? "")) ||
          (node.computed && !isNodeOfType(node.key, "Literal"))))
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    if (node.source.value !== "react" && node.source.value !== "twilio-video") return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || !hasCompleteSymbolReferences(symbol, program, context.scopes)) {
        supported = false;
        return false;
      }
      if (node.source.value === "twilio-video") {
        if (!hasOnlySelectedReferences(symbol, [], context)) supported = false;
        continue;
      }
      if (getValueImportSource(symbol) === null) continue;
      if (!isNodeOfType(specifier, "ImportSpecifier") || !hasReadonlyReferences(symbol)) {
        supported = false;
        return false;
      }
      if (
        getRuntimeSymbolReferences(symbol).some(
          (reference) =>
            !isNodeOfType(reference.identifier.parent, "CallExpression") ||
            reference.identifier.parent.optional ||
            reference.identifier.parent.callee !== reference.identifier,
        )
      )
        supported = false;
    }
  });
  return supported;
};

export const isMatchedSdkStateSnapshot = ({
  context,
  effectCall,
  fact,
}: MatchedSdkStateSnapshotInput): boolean => {
  const stateDeclarator = fact.stateDeclarator;
  const snapshotCall = fact.callExpression;
  if (
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.parent, "VariableDeclaration") ||
    stateDeclarator.parent.kind !== "const" ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    !isNodeOfType(stateDeclarator.init, "CallExpression") ||
    !isReadonlyNamedReactCall(stateDeclarator.init, "useState", context) ||
    !isNodeOfType(snapshotCall, "CallExpression") ||
    snapshotCall.optional ||
    !isNodeOfType(snapshotCall.callee, "Identifier") ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !isReadonlyNamedReactCall(effectCall, "useEffect", context)
  )
    return false;
  const [stateIdentifier, setterIdentifier, ...additionalBindings] = stateDeclarator.id.elements;
  const [initialValue, ...additionalInitializers] = stateDeclarator.init.arguments;
  const [snapshotValue, ...additionalSnapshotValues] = snapshotCall.arguments;
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(setterIdentifier, "Identifier") ||
    additionalBindings.length !== 0 ||
    !initialValue ||
    additionalInitializers.length !== 0 ||
    !snapshotValue ||
    additionalSnapshotValues.length !== 0
  )
    return false;
  const initialReceiver = getSnapshotReceiver(initialValue);
  const snapshotReceiver = getSnapshotReceiver(snapshotValue);
  const [effectCallback, dependencies, ...additionalEffectArguments] = effectCall.arguments;
  if (
    !initialReceiver ||
    !snapshotReceiver ||
    (!isNodeOfType(effectCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(effectCallback, "FunctionExpression")) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length !== 0 ||
    !isNodeOfType(effectCallback.body, "BlockStatement") ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    additionalEffectArguments.length !== 0
  )
    return false;
  const [dependency, ...additionalDependencies] = dependencies.elements;
  const [
    handlerDeclaration,
    snapshotStatement,
    registrationStatement,
    cleanupReturn,
    ...extraStatements
  ] = effectCallback.body.body;
  if (
    !isNodeOfType(dependency, "Identifier") ||
    additionalDependencies.length !== 0 ||
    !isNodeOfType(handlerDeclaration, "VariableDeclaration") ||
    handlerDeclaration.kind !== "const" ||
    !isNodeOfType(snapshotStatement, "ExpressionStatement") ||
    snapshotStatement.expression !== snapshotCall ||
    !isNodeOfType(registrationStatement, "ExpressionStatement") ||
    !isNodeOfType(registrationStatement.expression, "CallExpression") ||
    !isNodeOfType(cleanupReturn, "ReturnStatement") ||
    (!isNodeOfType(cleanupReturn.argument, "ArrowFunctionExpression") &&
      !isNodeOfType(cleanupReturn.argument, "FunctionExpression")) ||
    cleanupReturn.argument.params.length !== 0 ||
    extraStatements.length !== 0
  )
    return false;
  const [handlerDeclarator, ...additionalHandlers] = handlerDeclaration.declarations;
  if (
    !handlerDeclarator ||
    !isNodeOfType(handlerDeclarator.id, "Identifier") ||
    (!isNodeOfType(handlerDeclarator.init, "ArrowFunctionExpression") &&
      !isNodeOfType(handlerDeclarator.init, "FunctionExpression")) ||
    additionalHandlers.length !== 0
  )
    return false;
  const [payloadParameter, ...additionalParameters] = handlerDeclarator.init.params;
  const handlerCall = getOrdinaryCallbackCall(handlerDeclarator.init);
  const cleanupCall = getOrdinaryCallbackCall(cleanupReturn.argument);
  if (
    !isNodeOfType(payloadParameter, "Identifier") ||
    additionalParameters.length !== 0 ||
    !handlerCall ||
    !isNodeOfType(handlerCall.callee, "Identifier") ||
    !cleanupCall
  )
    return false;
  const [writtenPayload, ...additionalPayloads] = handlerCall.arguments;
  const registrationCall = registrationStatement.expression;
  const registrationReceiver = getListenerReceiver(registrationCall, "on");
  const cleanupReceiver =
    getListenerReceiver(cleanupCall, "off") ?? getListenerReceiver(cleanupCall, "removeListener");
  const [, registrationHandler] = registrationCall.arguments;
  const [, cleanupHandler] = cleanupCall.arguments;
  if (
    !isNodeOfType(writtenPayload, "Identifier") ||
    additionalPayloads.length !== 0 ||
    !registrationReceiver ||
    !cleanupReceiver ||
    !isNodeOfType(registrationHandler, "Identifier") ||
    !isNodeOfType(cleanupHandler, "Identifier")
  )
    return false;
  const receiverSymbol = context.scopes.symbolFor(initialReceiver);
  const setterSymbol = context.scopes.symbolFor(setterIdentifier);
  const handlerSymbol = context.scopes.symbolFor(handlerDeclarator.id);
  const payloadSymbol = context.scopes.symbolFor(payloadParameter);
  const ownerFunction = findEnclosingFunction(stateDeclarator);
  if (
    !receiverSymbol ||
    receiverSymbol.kind !== "parameter" ||
    !isNodeOfType(receiverSymbol.bindingIdentifier, "Identifier") ||
    (!isNodeOfType(ownerFunction, "FunctionDeclaration") &&
      !isNodeOfType(ownerFunction, "FunctionExpression") &&
      !isNodeOfType(ownerFunction, "ArrowFunctionExpression")) ||
    ownerFunction.async ||
    ownerFunction.generator ||
    !isNodeOfType(ownerFunction.body, "BlockStatement") ||
    !ownerFunction.params.some((parameter) => parameter === receiverSymbol.bindingIdentifier) ||
    stateDeclarator.parent.parent !== ownerFunction.body ||
    !isNodeOfType(effectCall.parent, "ExpressionStatement") ||
    effectCall.parent.parent !== ownerFunction.body ||
    !setterSymbol ||
    setterSymbol.declarationNode !== stateDeclarator ||
    context.scopes.symbolFor(snapshotCall.callee) !== setterSymbol ||
    context.scopes.symbolFor(handlerCall.callee) !== setterSymbol ||
    !handlerSymbol ||
    handlerSymbol.declarationNode !== handlerDeclarator ||
    !payloadSymbol ||
    payloadSymbol.bindingIdentifier !== payloadParameter ||
    context.scopes.symbolFor(writtenPayload) !== payloadSymbol ||
    !hasParticipantTypeRole(receiverSymbol, context)
  )
    return false;
  return (
    hasOrdinarySdkSnapshotProviders(context) &&
    hasOnlySelectedReferences(
      receiverSymbol,
      [initialReceiver, snapshotReceiver, registrationReceiver, cleanupReceiver, dependency],
      context,
    ) &&
    hasOnlySelectedReferences(setterSymbol, [snapshotCall.callee, handlerCall.callee], context) &&
    hasOnlySelectedReferences(handlerSymbol, [registrationHandler, cleanupHandler], context) &&
    hasOnlySelectedReferences(payloadSymbol, [writtenPayload], context) &&
    hasSupportedTwilioVideoSnapshotApi(context.filename)
  );
};
