import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getRequireCallSource } from "../../../utils/get-require-call-source.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  CANCEL_STATEMENT_COUNT,
  EMPTY_ARGUMENT_COUNT,
  NATIVE_PROVIDER_NAMES,
  RECORD_FIELD_COUNT,
  REFLECTION_PROPERTY_NAMES,
  REMOVAL_STATEMENT_COUNT,
  RESET_STATEMENT_COUNT,
  RUNTIME_DECLARATION_TYPES,
  SINGLE_ARGUMENT_COUNT,
} from "./owned-controller-record-reset/constants.js";

interface ControllerRecordCertificate {
  context: RuleContext;
  component: EsTreeNode;
  registry: SymbolDescriptor;
  setter: SymbolDescriptor;
  allowedReferences: Set<EsTreeNode>;
  allowedUpdates: Set<EsTreeNode>;
  controlledSymbols: Set<SymbolDescriptor>;
  registryCalls: Set<EsTreeNode>;
  stateWrites: Set<EsTreeNode>;
  removalFunctions: Map<SymbolDescriptor, EsTreeNode>;
  insertionFunctions: Map<EsTreeNode, ControllerRecordInsertion>;
}

interface ControllerRecordInsertion {
  key: EsTreeNode;
}

const supportedPrograms = new WeakMap<ScopeAnalysis, boolean>();
const controllerRecordCertificates = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

const isRuntimeGlobalReference = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (context.scopes.isGlobalReference(identifier)) return true;
  const reference = context.scopes.referenceFor(identifier);
  const symbol = reference?.resolvedSymbol;
  return Boolean(symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol));
};

const canonicalReactCall = (node: EsTreeNode, name: string, context: RuleContext): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isReactApiCall(node, name, context.scopes)
  )
    return false;
  const callee = node.callee;
  const provider = isNodeOfType(callee, "Identifier")
    ? callee
    : isNodeOfType(callee, "MemberExpression") && !callee.computed && !callee.optional
      ? callee.object
      : null;
  if (!isNodeOfType(provider, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(provider);
  const specifier = symbol?.declarationNode;
  const declaration = specifier?.parent;
  return Boolean(
    symbol?.kind === "import" &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type"),
  );
};

const symbolFor = (node: EsTreeNode, certificate: ControllerRecordCertificate) =>
  certificate.context.scopes.symbolFor(node);

const sameBinding = (
  first: EsTreeNode | null | undefined,
  second: EsTreeNode | null | undefined,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (!isNodeOfType(first, "Identifier") || !isNodeOfType(second, "Identifier")) return false;
  const symbol = symbolFor(first, certificate);
  return Boolean(symbol && symbol === symbolFor(second, certificate));
};

const hasReadonlyBinding = (
  node: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  const symbol = symbolFor(node, certificate);
  return Boolean(
    symbol &&
    (symbol.kind === "const" || symbol.kind === "parameter") &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ),
  );
};

const trackBinding = (node: EsTreeNode, certificate: ControllerRecordCertificate): boolean => {
  const symbol = symbolFor(node, certificate);
  if (!symbol || !hasReadonlyBinding(node, certificate)) return false;
  certificate.controlledSymbols.add(symbol);
  return true;
};

const allowReferencesIn = (node: EsTreeNode, certificate: ControllerRecordCertificate): void => {
  walkAst(node, (child) => {
    if (isTypeScriptTypePosition(child)) return false;
    if (isNodeOfType(child, "Identifier")) certificate.allowedReferences.add(child);
  });
};

const nativeConstruction = (
  node: EsTreeNode | null | undefined,
  name: string,
  context: RuleContext,
): node is EsTreeNodeOfType<"NewExpression"> =>
  isNodeOfType(node, "NewExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  node.callee.name === name &&
  isRuntimeGlobalReference(node.callee, context);

const emptyNativeConstruction = (
  node: EsTreeNode | null | undefined,
  name: string,
  context: RuleContext,
): boolean =>
  nativeConstruction(node, name, context) && node.arguments.length === EMPTY_ARGUMENT_COUNT;

const methodCall = (
  node: EsTreeNode | null | undefined,
  name: string,
  argumentCount: number,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  !node.callee.computed &&
  getStaticPropertyName(node.callee) === name &&
  node.arguments.length === argumentCount;

const expressionStatement = (node: EsTreeNode | null | undefined): EsTreeNode | null =>
  isNodeOfType(node, "ExpressionStatement") ? stripParenExpression(node.expression) : null;

const singleDeclaration = (
  statement: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== SINGLE_ARGUMENT_COUNT
  )
    return null;
  const [declaration] = statement.declarations;
  return declaration ?? null;
};

const bareReturn = (node: EsTreeNode | null | undefined): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return !node.argument;
  if (!isNodeOfType(node, "BlockStatement") || node.body.length !== SINGLE_ARGUMENT_COUNT)
    return false;
  const [statement] = node.body;
  return isNodeOfType(statement, "ReturnStatement") && !statement.argument;
};

const parameterAnnotation = (
  node: EsTreeNode,
  certificate: ControllerRecordCertificate,
): string | undefined => {
  const binding = symbolFor(node, certificate)?.bindingIdentifier;
  return isNodeOfType(binding, "Identifier")
    ? binding.typeAnnotation?.typeAnnotation.type
    : undefined;
};

const typedParameter = (
  node: EsTreeNode | null | undefined,
  keyword: string,
  certificate: ControllerRecordCertificate,
): node is EsTreeNodeOfType<"Identifier"> =>
  isNodeOfType(node, "Identifier") &&
  isNodeOfType(symbolFor(node, certificate)?.bindingIdentifier, "Identifier") &&
  parameterAnnotation(node, certificate) === keyword &&
  symbolFor(node, certificate)?.kind === "parameter" &&
  hasReadonlyBinding(node, certificate);

const refCurrent = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  certificate: ControllerRecordCertificate,
): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === "current" &&
  isNodeOfType(node.object, "Identifier") &&
  symbolFor(node.object, certificate) === symbol;

const registryCall = (
  node: EsTreeNode | null | undefined,
  name: string,
  argumentCount: number,
  certificate: ControllerRecordCertificate,
): node is EsTreeNodeOfType<"CallExpression"> =>
  methodCall(node, name, argumentCount) &&
  isNodeOfType(node.callee, "MemberExpression") &&
  refCurrent(node.callee.object, certificate.registry, certificate);

const acceptRegistryCall = (node: EsTreeNode, certificate: ControllerRecordCertificate): void => {
  certificate.registryCalls.add(node);
  allowReferencesIn(node, certificate);
};

const isSetterCall = (
  node: EsTreeNode | null | undefined,
  certificate: ControllerRecordCertificate,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === SINGLE_ARGUMENT_COUNT &&
  isNodeOfType(node.callee, "Identifier") &&
  symbolFor(node.callee, certificate) === certificate.setter;

const setAddition = (
  node: EsTreeNode | null | undefined,
  key: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (!isSetterCall(node, certificate)) return false;
  const [updater] = node.arguments;
  if (
    !isFunctionLike(updater) ||
    updater.async ||
    updater.generator ||
    updater.params.length !== SINGLE_ARGUMENT_COUNT
  )
    return false;
  const [previous] = updater.params;
  const body = stripParenExpression(updater.body);
  if (!isNodeOfType(previous, "Identifier") || !methodCall(body, "add", SINGLE_ARGUMENT_COUNT))
    return false;
  if (!isNodeOfType(body.callee, "MemberExpression")) return false;
  const copy = body.callee.object;
  const [addedKey] = body.arguments;
  if (
    !nativeConstruction(copy, "Set", certificate.context) ||
    copy.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !sameBinding(copy.arguments.at(EMPTY_ARGUMENT_COUNT), previous, certificate) ||
    !sameBinding(addedKey, key, certificate)
  )
    return false;
  if (!trackBinding(previous, certificate)) return false;
  allowReferencesIn(updater.body, certificate);
  certificate.stateWrites.add(node);
  return true;
};

const setDeletion = (
  node: EsTreeNode | null | undefined,
  key: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (!isSetterCall(node, certificate)) return false;
  const [updater] = node.arguments;
  if (
    !isFunctionLike(updater) ||
    updater.async ||
    updater.generator ||
    updater.params.length !== SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(updater.body, "BlockStatement")
  )
    return false;
  const [previous] = updater.params;
  if (!isNodeOfType(previous, "Identifier")) return false;
  const statements = [...updater.body.body];
  const [first] = statements;
  if (isNodeOfType(first, "IfStatement")) {
    const test = stripParenExpression(first.test);
    const consequence = isNodeOfType(first.consequent, "ReturnStatement") ? first.consequent : null;
    if (
      first.alternate ||
      !isNodeOfType(test, "UnaryExpression") ||
      test.operator !== "!" ||
      !methodCall(test.argument, "has", SINGLE_ARGUMENT_COUNT) ||
      !isNodeOfType(test.argument.callee, "MemberExpression") ||
      !sameBinding(test.argument.callee.object, previous, certificate) ||
      !sameBinding(test.argument.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
      !sameBinding(consequence?.argument, previous, certificate)
    )
      return false;
    statements.shift();
  }
  const [copyStatement, deleteStatement, returnStatement] = statements;
  const copy = singleDeclaration(copyStatement);
  const deletion = expressionStatement(deleteStatement);
  if (
    statements.length !== RESET_STATEMENT_COUNT ||
    !copy ||
    !isNodeOfType(copy.id, "Identifier") ||
    !nativeConstruction(copy.init, "Set", certificate.context) ||
    copy.init.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !sameBinding(copy.init.arguments.at(EMPTY_ARGUMENT_COUNT), previous, certificate) ||
    !methodCall(deletion, "delete", SINGLE_ARGUMENT_COUNT) ||
    !isNodeOfType(deletion.callee, "MemberExpression") ||
    !sameBinding(deletion.callee.object, copy.id, certificate) ||
    !sameBinding(deletion.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !sameBinding(returnStatement.argument, copy.id, certificate) ||
    !trackBinding(previous, certificate) ||
    !trackBinding(copy.id, certificate)
  )
    return false;
  allowReferencesIn(updater.body, certificate);
  certificate.stateWrites.add(node);
  return true;
};

const fieldOf = (
  node: EsTreeNode | null | undefined,
  name: string,
  receiver: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  const member = node ? stripParenExpression(node) : null;
  return (
    isNodeOfType(member, "MemberExpression") &&
    !member.computed &&
    getStaticPropertyName(member) === name &&
    sameBinding(member.object, receiver, certificate)
  );
};

const missingOrStale = (
  node: EsTreeNode,
  active: EsTreeNode,
  attempt: EsTreeNode,
  certificate: ControllerRecordCertificate,
  hasAbsenceGuard = false,
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "||") {
    return (
      isNodeOfType(expression.left, "UnaryExpression") &&
      expression.left.operator === "!" &&
      sameBinding(expression.left.argument, active, certificate) &&
      missingOrStale(expression.right, active, attempt, certificate, true)
    );
  }
  const left = isNodeOfType(expression, "BinaryExpression")
    ? stripParenExpression(expression.left)
    : null;
  return (
    isNodeOfType(expression, "BinaryExpression") &&
    expression.operator === "!==" &&
    fieldOf(expression.left, "attempt", active, certificate) &&
    (hasAbsenceGuard || (isNodeOfType(left, "MemberExpression") && left.optional)) &&
    sameBinding(expression.right, attempt, certificate)
  );
};

const getRecordDeclaration = (
  statement: EsTreeNode | null | undefined,
  key: EsTreeNode,
  certificate: ControllerRecordCertificate,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  const declaration = singleDeclaration(statement);
  if (
    !declaration ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !registryCall(declaration.init, "get", SINGLE_ARGUMENT_COUNT, certificate) ||
    !sameBinding(declaration.init.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
    !trackBinding(declaration.id, certificate)
  )
    return null;
  acceptRegistryCall(declaration.init, certificate);
  return declaration;
};

const removalPair = (
  statements: readonly EsTreeNode[],
  key: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  const [deleteStatement, stateStatement] = statements;
  const deletion = expressionStatement(deleteStatement);
  if (
    statements.length !== RECORD_FIELD_COUNT ||
    !registryCall(deletion, "delete", SINGLE_ARGUMENT_COUNT, certificate) ||
    !sameBinding(deletion.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
    !setDeletion(expressionStatement(stateStatement), key, certificate)
  )
    return false;
  acceptRegistryCall(deletion, certificate);
  return true;
};

const functionBinding = (
  owner: EsTreeNode,
  certificate: ControllerRecordCertificate,
): SymbolDescriptor | null => {
  const parent = owner.parent;
  const declaration = isNodeOfType(parent, "VariableDeclarator")
    ? parent
    : isNodeOfType(parent, "CallExpression") &&
        canonicalReactCall(parent, "useCallback", certificate.context) &&
        parent.arguments.length === RECORD_FIELD_COUNT &&
        parent.arguments.at(EMPTY_ARGUMENT_COUNT) === owner &&
        isNodeOfType(parent.arguments.at(SINGLE_ARGUMENT_COUNT), "ArrayExpression") &&
        isNodeOfType(parent.parent, "VariableDeclarator")
      ? parent.parent
      : null;
  if (
    !declaration ||
    !isNodeOfType(declaration.id, "Identifier") ||
    findEnclosingFunction(declaration) !== certificate.component ||
    !trackBinding(declaration.id, certificate)
  )
    return null;
  return symbolFor(declaration.id, certificate);
};

const removalFunction = (owner: EsTreeNode, certificate: ControllerRecordCertificate): boolean => {
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.params.length !== RECORD_FIELD_COUNT ||
    owner.body.body.length !== REMOVAL_STATEMENT_COUNT
  )
    return false;
  const [key, attempt] = owner.params;
  if (
    !typedParameter(key, "TSStringKeyword", certificate) ||
    !typedParameter(attempt, "TSNumberKeyword", certificate)
  )
    return false;
  const [getStatement, guard, ...deletions] = owner.body.body;
  const active = getRecordDeclaration(getStatement, key, certificate);
  if (
    !active ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !bareReturn(guard.consequent) ||
    !missingOrStale(guard.test, active.id, attempt, certificate) ||
    !removalPair(deletions, key, certificate)
  )
    return false;
  const binding = functionBinding(owner, certificate);
  if (!binding) return false;
  allowReferencesIn(guard, certificate);
  certificate.removalFunctions.set(binding, owner);
  return true;
};

const removalInvocation = (
  call: EsTreeNode | null | undefined,
  key: EsTreeNode,
  attempt: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== RECORD_FIELD_COUNT ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const binding = symbolFor(call.callee, certificate);
  const [passedKey, passedAttempt] = call.arguments;
  if (
    !binding ||
    !certificate.removalFunctions.has(binding) ||
    !sameBinding(passedKey, key, certificate) ||
    !sameBinding(passedAttempt, attempt, certificate)
  )
    return false;
  allowReferencesIn(call, certificate);
  return true;
};

const abortCall = (
  call: EsTreeNode | null | undefined,
  controller: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean =>
  methodCall(call, "abort", EMPTY_ARGUMENT_COUNT) &&
  isNodeOfType(call.callee, "MemberExpression") &&
  sameBinding(call.callee.object, controller, certificate);

const recordPattern = (
  pattern: EsTreeNode,
  fields: readonly string[],
): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(pattern, "ObjectPattern") || pattern.properties.length !== fields.length)
    return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of pattern.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || !fields.includes(name) || result.has(name)) return null;
    result.set(name, property.value);
  }
  return result;
};

const cancellationFunction = (
  owner: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.params.length !== SINGLE_ARGUMENT_COUNT ||
    owner.body.body.length !== CANCEL_STATEMENT_COUNT
  )
    return false;
  const [key] = owner.params;
  if (!typedParameter(key, "TSStringKeyword", certificate)) return false;
  const [getStatement, guard, destructureStatement, abortStatement, removeStatement] =
    owner.body.body;
  const active = getRecordDeclaration(getStatement, key, certificate);
  const destructure = singleDeclaration(destructureStatement);
  const pattern = destructure ? recordPattern(destructure.id, ["controller", "attempt"]) : null;
  const controller = pattern?.get("controller");
  const attempt = pattern?.get("attempt");
  if (
    !active ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !bareReturn(guard.consequent) ||
    !isNodeOfType(guard.test, "UnaryExpression") ||
    guard.test.operator !== "!" ||
    !sameBinding(guard.test.argument, active.id, certificate) ||
    !sameBinding(destructure?.init, active.id, certificate) ||
    !controller ||
    !attempt ||
    !trackBinding(controller, certificate) ||
    !trackBinding(attempt, certificate) ||
    !abortCall(expressionStatement(abortStatement), controller, certificate) ||
    !removalInvocation(expressionStatement(removeStatement), key, attempt, certificate)
  )
    return false;
  const binding = functionBinding(owner, certificate);
  if (!binding) return false;
  allowReferencesIn(guard, certificate);
  if (destructure) allowReferencesIn(destructure, certificate);
  if (abortStatement) allowReferencesIn(abortStatement, certificate);
  for (const reference of binding.references) {
    const call = reference.identifier.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== reference.identifier) return false;
    certificate.allowedReferences.add(reference.identifier);
  }
  return true;
};

const staleGuardIn = (
  block: EsTreeNode,
  key: EsTreeNode,
  attempt: EsTreeNode,
  certificate: ControllerRecordCertificate,
  requiresEarlierAwait = false,
): boolean => {
  if (!isNodeOfType(block, "BlockStatement")) return false;
  let active: EsTreeNode | null = null;
  let hasEarlierAwait = !requiresEarlierAwait;
  for (const statement of block.body) {
    const awaitedExpression = expressionStatement(statement) ?? singleDeclaration(statement)?.init;
    if (
      awaitedExpression &&
      isNodeOfType(stripParenExpression(awaitedExpression), "AwaitExpression")
    )
      hasEarlierAwait = true;
    const declaration = singleDeclaration(statement);
    if (declaration && registryCall(declaration.init, "get", SINGLE_ARGUMENT_COUNT, certificate)) {
      const record = getRecordDeclaration(statement, key, certificate);
      if (!record) return false;
      active = record.id;
      continue;
    }
    if (
      !isNodeOfType(statement, "IfStatement") ||
      statement.alternate ||
      !bareReturn(statement.consequent)
    )
      continue;
    if (active && missingOrStale(statement.test, active, attempt, certificate)) {
      if (!hasEarlierAwait) return false;
      allowReferencesIn(statement.test, certificate);
      return true;
    }
    const test = stripParenExpression(statement.test);
    if (
      isNodeOfType(test, "BinaryExpression") &&
      test.operator === "!==" &&
      sameBinding(test.right, attempt, certificate)
    ) {
      const member = stripParenExpression(test.left);
      if (
        isNodeOfType(member, "MemberExpression") &&
        member.optional &&
        !member.computed &&
        getStaticPropertyName(member) === "attempt" &&
        registryCall(member.object, "get", SINGLE_ARGUMENT_COUNT, certificate) &&
        sameBinding(member.object.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate)
      ) {
        if (!hasEarlierAwait) return false;
        acceptRegistryCall(member.object, certificate);
        allowReferencesIn(test, certificate);
        return true;
      }
    }
  }
  return false;
};

const finalRemoval = (
  finalizer: EsTreeNode,
  key: EsTreeNode,
  attempt: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (!isNodeOfType(finalizer, "BlockStatement")) return false;
  const [first, second] = finalizer.body;
  if (finalizer.body.length === SINGLE_ARGUMENT_COUNT)
    return removalInvocation(expressionStatement(first), key, attempt, certificate);
  const active = getRecordDeclaration(first, key, certificate);
  if (
    finalizer.body.length !== RECORD_FIELD_COUNT ||
    !active ||
    !isNodeOfType(second, "IfStatement") ||
    second.alternate ||
    !isNodeOfType(second.test, "BinaryExpression") ||
    second.test.operator !== "===" ||
    !fieldOf(second.test.left, "attempt", active.id, certificate) ||
    !sameBinding(second.test.right, attempt, certificate) ||
    !isNodeOfType(second.consequent, "BlockStatement") ||
    !removalPair(second.consequent.body, key, certificate)
  )
    return false;
  allowReferencesIn(second.test, certificate);
  return true;
};

const recordFields = (record: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(record, "ObjectExpression") || record.properties.length !== RECORD_FIELD_COUNT)
    return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of record.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || (name !== "controller" && name !== "attempt") || fields.has(name)) return null;
    fields.set(name, property.value);
  }
  return fields;
};

const signalTransport = (signal: EsTreeNode): boolean => {
  let current = signal;
  let parent = current.parent;
  while (parent) {
    if (isNodeOfType(parent, "CallExpression"))
      return parent.arguments.some((argument) => argument === current);
    if (
      isNodeOfType(parent, "Property") &&
      parent.value === current &&
      parent.kind === "init" &&
      !parent.computed &&
      !parent.method &&
      isNodeOfType(parent.parent, "ObjectExpression")
    ) {
      current = parent.parent;
      parent = current.parent;
      continue;
    }
    return false;
  }
  return false;
};

const controllerOrigin = (
  identifier: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  const root = resolveConstIdentifierAlias(identifier, certificate.context.scopes);
  if (
    !root ||
    root.kind !== "const" ||
    !emptyNativeConstruction(root.initializer, "AbortController", certificate.context)
  )
    return false;
  let current: EsTreeNode = identifier;
  const visited = new Set<SymbolDescriptor>();
  while (isNodeOfType(current, "Identifier")) {
    const symbol = symbolFor(current, certificate);
    if (!symbol || visited.has(symbol) || !trackBinding(current, certificate)) return false;
    visited.add(symbol);
    for (const reference of symbol.references) {
      const member = reference.identifier.parent;
      if (
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        !member.computed &&
        !member.optional &&
        getStaticPropertyName(member) === "signal" &&
        signalTransport(member) &&
        !isWithinAssignmentTarget(member)
      )
        certificate.allowedReferences.add(reference.identifier);
    }
    if (symbol === root) return true;
    if (!symbol.initializer) return false;
    certificate.allowedReferences.add(symbol.initializer);
    current = stripParenExpression(symbol.initializer);
  }
  return false;
};

const insertion = (
  call: EsTreeNodeOfType<"CallExpression">,
  certificate: ControllerRecordCertificate,
): boolean => {
  const [key, record] = call.arguments;
  if (!key || !record || !typedParameter(key, "TSStringKeyword", certificate)) return false;
  const fields = recordFields(record);
  const controller = fields?.get("controller");
  const attempt = fields?.get("attempt");
  const attemptSymbol = attempt ? symbolFor(attempt, certificate) : null;
  const update = attemptSymbol?.initializer;
  const counter = isNodeOfType(update, "UpdateExpression") ? update.argument : null;
  const counterSymbol = isNodeOfType(counter, "MemberExpression")
    ? symbolFor(counter.object, certificate)
    : null;
  const counterInitializer = counterSymbol?.initializer;
  const counterInitialValue = isNodeOfType(counterInitializer, "CallExpression")
    ? counterInitializer.arguments.at(EMPTY_ARGUMENT_COUNT)
    : null;
  if (
    !controller ||
    !attempt ||
    !controllerOrigin(controller, certificate) ||
    !trackBinding(attempt, certificate) ||
    !isNodeOfType(update, "UpdateExpression") ||
    update.operator !== "++" ||
    !update.prefix ||
    !counterSymbol ||
    !counter ||
    !refCurrent(counter, counterSymbol, certificate) ||
    !isNodeOfType(counterInitializer, "CallExpression") ||
    !canonicalReactCall(counterInitializer, "useRef", certificate.context) ||
    counterInitializer.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(counterInitialValue, "Literal") ||
    counterInitialValue.value !== EMPTY_ARGUMENT_COUNT ||
    counterSymbol.kind !== "const" ||
    findEnclosingFunction(counterSymbol.declarationNode) !== certificate.component
  )
    return false;
  const statement = call.parent;
  const block = statement?.parent;
  const owner = findEnclosingFunction(call);
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    !isFunctionLike(owner) ||
    !owner.async ||
    owner.generator ||
    !owner.params.every((parameter) => typedParameter(parameter, "TSStringKeyword", certificate)) ||
    findEnclosingFunction(symbolFor(key, certificate)?.bindingIdentifier ?? call) !== owner ||
    owner.body !== block ||
    certificate.insertionFunctions.has(owner)
  )
    return false;
  const position = block.body.findIndex((candidate) => candidate === statement);
  const attemptDeclaration = singleDeclaration(block.body.at(position - SINGLE_ARGUMENT_COUNT));
  if (
    !attemptDeclaration ||
    !sameBinding(attemptDeclaration.id, attempt, certificate) ||
    findEnclosingFunction(attemptSymbol?.declarationNode ?? call) !== owner ||
    findEnclosingFunction(
      resolveConstIdentifierAlias(controller, certificate.context.scopes)?.declarationNode ?? call,
    ) !== owner
  )
    return false;
  const mark = block.body.at(position + SINGLE_ARGUMENT_COUNT);
  const request = block.body.at(position + RECORD_FIELD_COUNT);
  if (
    !setAddition(expressionStatement(mark), key, certificate) ||
    !isNodeOfType(request, "TryStatement") ||
    !request.handler ||
    !request.finalizer ||
    !staleGuardIn(request.block, key, attempt, certificate, true) ||
    !staleGuardIn(request.handler.body, key, attempt, certificate) ||
    !finalRemoval(request.finalizer, key, attempt, certificate)
  )
    return false;
  const binding = functionBinding(owner, certificate);
  if (!binding) return false;
  for (const reference of binding.references) {
    const parent = reference.identifier.parent;
    if (!isNodeOfType(parent, "CallExpression") || parent.callee !== reference.identifier)
      return false;
    certificate.allowedReferences.add(reference.identifier);
  }
  certificate.insertionFunctions.set(owner, { key });
  acceptRegistryCall(call, certificate);
  certificate.controlledSymbols.add(counterSymbol);
  if (isNodeOfType(counter, "MemberExpression")) certificate.allowedUpdates.add(counter.object);
  allowReferencesIn(update, certificate);
  return true;
};

const releaseCallback = (
  callback: EsTreeNode,
  certificate: ControllerRecordCertificate,
): boolean => {
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== SINGLE_ARGUMENT_COUNT
  )
    return false;
  const [parameter] = callback.params;
  if (!parameter) return false;
  const body = stripParenExpression(callback.body);
  const release =
    isNodeOfType(body, "BlockStatement") && body.body.length === SINGLE_ARGUMENT_COUNT
      ? expressionStatement(body.body.at(EMPTY_ARGUMENT_COUNT))
      : body;
  const pattern = recordPattern(parameter, ["controller"]);
  const controller = pattern?.get("controller");
  if (controller) {
    if (!trackBinding(controller, certificate) || !abortCall(release, controller, certificate))
      return false;
  } else {
    if (
      !isNodeOfType(parameter, "Identifier") ||
      !trackBinding(parameter, certificate) ||
      !methodCall(release, "abort", EMPTY_ARGUMENT_COUNT) ||
      !isNodeOfType(release.callee, "MemberExpression") ||
      !fieldOf(release.callee.object, "controller", parameter, certificate)
    )
      return false;
  }
  if (release) allowReferencesIn(release, certificate);
  return true;
};

const directRef = (
  node: EsTreeNode,
  certificate: ControllerRecordCertificate,
): SymbolDescriptor | null => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.computed ||
    node.optional ||
    getStaticPropertyName(node) !== "current" ||
    !isNodeOfType(node.object, "Identifier")
  )
    return null;
  const symbol = symbolFor(node.object, certificate);
  const initializer = symbol?.initializer;
  return symbol?.kind === "const" &&
    findEnclosingFunction(symbol.declarationNode) === certificate.component &&
    isNodeOfType(initializer, "CallExpression") &&
    canonicalReactCall(initializer, "useRef", certificate.context) &&
    initializer.arguments.length === SINGLE_ARGUMENT_COUNT &&
    emptyNativeConstruction(
      initializer.arguments.at(EMPTY_ARGUMENT_COUNT),
      "Map",
      certificate.context,
    )
    ? symbol
    : null;
};

const hasComputedProviderUse = (member: EsTreeNode, context: RuleContext): boolean => {
  const pending: EsTreeNode[] = [member];
  const visited = new Set<SymbolDescriptor>();
  while (pending.length > EMPTY_ARGUMENT_COUNT) {
    const next = pending.pop();
    if (!next) continue;
    const value = findTransparentExpressionRoot(next);
    const parent = value.parent;
    if (
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
      parent.callee === value
    )
      return true;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === value) return true;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === value &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(parent.id);
      if (
        symbol?.kind === "const" &&
        !visited.has(symbol) &&
        symbol.references.every((reference) => reference.flag === "read")
      ) {
        visited.add(symbol);
        for (const reference of symbol.references) pending.push(reference.identifier);
      }
    }
  }
  return false;
};

const supportedProgram = (program: EsTreeNode, context: RuleContext): boolean => {
  const cached = supportedPrograms.get(context.scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (RUNTIME_DECLARATION_TYPES.has(node.type) || ("declare" in node && node.declare === true)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier")) {
      const reference = context.scopes.referenceFor(node);
      if (!reference) return;
      const symbol = reference.resolvedSymbol;
      const declaration = symbol?.declarationNode;
      const provider = declaration?.parent;
      if (
        (isNodeOfType(declaration, "ImportSpecifier") && declaration.importKind === "type") ||
        (isNodeOfType(provider, "ImportDeclaration") && provider.importKind === "type")
      )
        supported = false;
      if (
        node.name === "eval" ||
        ((symbol?.kind === "ts-interface" || symbol?.kind === "ts-type-alias") &&
          !(NATIVE_PROVIDER_NAMES.has(node.name) && isRuntimeGlobalReference(node, context))) ||
        (NATIVE_PROVIDER_NAMES.has(node.name) &&
          isRuntimeGlobalReference(node, context) &&
          (!isNodeOfType(node.parent, "NewExpression") ||
            node.parent.callee !== node ||
            node.name === "Function"))
      )
        supported = false;
    }
    if (isNodeOfType(node, "MemberExpression") || isNodeOfType(node, "Property")) {
      const name = getResolvedStaticPropertyName(node, context.scopes, {
        allowConstTemplateLiteral: true,
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        REFLECTION_PROPERTY_NAMES.has(name ?? "") ||
        (isNodeOfType(node, "MemberExpression") &&
          isMemberMutationTarget(node) &&
          (name === "useState" ||
            name === "useRef" ||
            name === "useEffect" ||
            name === "useCallback") &&
          isLoadedReactProvider(node.object, context)) ||
        (isNodeOfType(node, "MemberExpression") &&
          node.computed &&
          name === null &&
          hasComputedProviderUse(node, context))
      )
        supported = false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === "react" &&
      node.importKind !== "type"
    ) {
      for (const specifier of node.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const symbol = context.scopes.symbolFor(specifier.local);
        if (!symbol) {
          supported = false;
          return false;
        }
        const namespace =
          specifier.type !== "ImportSpecifier" || getImportedName(specifier) === "default";
        for (const reference of symbol.references) {
          const parent = reference.identifier.parent;
          if (isTypeScriptTypePosition(reference.identifier)) continue;
          if (
            reference.flag !== "read" ||
            (namespace
              ? !isNodeOfType(parent, "MemberExpression") ||
                parent.object !== reference.identifier ||
                parent.computed ||
                parent.optional ||
                !isNodeOfType(parent.parent, "CallExpression") ||
                parent.parent.callee !== parent
              : !isNodeOfType(parent, "CallExpression") || parent.callee !== reference.identifier)
          )
            supported = false;
        }
      }
    }
  });
  supportedPrograms.set(context.scopes, supported);
  return supported;
};

const isLoadedReactProvider = (
  expression: EsTreeNode,
  context: RuleContext,
  allowModuleRequire = false,
): boolean => {
  let current = stripParenExpression(expression);
  const visitedSymbols = new Set<SymbolDescriptor>();
  while (true) {
    if (isNodeOfType(current, "Identifier")) {
      const symbol = resolveConstIdentifierAlias(current, context.scopes);
      if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbols.has(symbol))
        return false;
      visitedSymbols.add(symbol);
      current = stripParenExpression(symbol.initializer);
      continue;
    }
    if (isNodeOfType(current, "MemberExpression") && getStaticPropertyName(current) === "default") {
      current = stripParenExpression(current.object);
      continue;
    }
    if (
      allowModuleRequire &&
      isNodeOfType(current, "CallExpression") &&
      !current.optional &&
      isNodeOfType(current.callee, "MemberExpression") &&
      !current.callee.optional &&
      !current.callee.computed &&
      getStaticPropertyName(current.callee) === "require" &&
      isNodeOfType(current.callee.object, "Identifier") &&
      current.callee.object.name === "module" &&
      isRuntimeGlobalReference(current.callee.object, context) &&
      current.arguments.length === SINGLE_ARGUMENT_COUNT
    ) {
      const [source] = current.arguments;
      return isNodeOfType(source, "Literal") && source.value === "react";
    }
    return (
      isNodeOfType(current, "CallExpression") &&
      !current.optional &&
      isNodeOfType(current.callee, "Identifier") &&
      current.callee.name === "require" &&
      isRuntimeGlobalReference(current.callee, context) &&
      getRequireCallSource(current) === "react"
    );
  }
};

const certifyOwnedControllerRecordReset = (write: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(write, "CallExpression") || write.arguments.length !== SINGLE_ARGUMENT_COUNT)
    return false;
  const [emptyState] = write.arguments;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const owner = findEnclosingFunction(write);
  const component = pair ? findEnclosingFunction(pair.declarator) : null;
  const program = findProgramRoot(write);
  if (
    !emptyNativeConstruction(emptyState, "Set", context) ||
    !pair?.stateSymbol ||
    pair.setterSymbol.kind !== "const" ||
    pair.stateSymbol.kind !== "const" ||
    !component ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== EMPTY_ARGUMENT_COUNT ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !canonicalReactCall(pair.declarator.init, "useState", context) ||
    pair.declarator.init.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !emptyNativeConstruction(
      pair.declarator.init.arguments.at(EMPTY_ARGUMENT_COUNT),
      "Set",
      context,
    ) ||
    !program ||
    !supportedProgram(program, context)
  )
    return false;
  const statements = [...owner.body.body];
  const possibleGuard = statements.length === REMOVAL_STATEMENT_COUNT ? statements.shift() : null;
  const [releaseStatement, clearStatement, resetStatement] = statements;
  const release = expressionStatement(releaseStatement);
  if (
    statements.length !== RESET_STATEMENT_COUNT ||
    expressionStatement(resetStatement) !== write ||
    !methodCall(release, "forEach", SINGLE_ARGUMENT_COUNT) ||
    !isNodeOfType(release.callee, "MemberExpression")
  )
    return false;
  const certificate: ControllerRecordCertificate = {
    context,
    component,
    registry: pair.setterSymbol,
    setter: pair.setterSymbol,
    allowedReferences: new Set(),
    allowedUpdates: new Set(),
    controlledSymbols: new Set([pair.setterSymbol]),
    registryCalls: new Set(),
    stateWrites: new Set([write]),
    removalFunctions: new Map(),
    insertionFunctions: new Map(),
  };
  const registry = directRef(release.callee.object, certificate);
  if (!registry) return false;
  certificate.registry = registry;
  if (!trackBinding(registry.bindingIdentifier, certificate)) return false;
  const [callback] = release.arguments;
  const clear = expressionStatement(clearStatement);
  if (
    !callback ||
    !releaseCallback(callback, certificate) ||
    !registryCall(clear, "clear", EMPTY_ARGUMENT_COUNT, certificate)
  )
    return false;
  if (possibleGuard) {
    if (
      !isNodeOfType(possibleGuard, "IfStatement") ||
      possibleGuard.alternate ||
      !bareReturn(possibleGuard.consequent) ||
      !isNodeOfType(possibleGuard.test, "BinaryExpression") ||
      possibleGuard.test.operator !== "===" ||
      !isNodeOfType(possibleGuard.test.left, "MemberExpression") ||
      getStaticPropertyName(possibleGuard.test.left) !== "size" ||
      !refCurrent(possibleGuard.test.left.object, registry, certificate) ||
      !isNodeOfType(possibleGuard.test.right, "Literal") ||
      possibleGuard.test.right.value !== EMPTY_ARGUMENT_COUNT
    )
      return false;
    allowReferencesIn(possibleGuard.test, certificate);
  }
  acceptRegistryCall(release, certificate);
  acceptRegistryCall(clear, certificate);
  const resetBinding = functionBinding(owner, certificate);
  if (!resetBinding) return false;
  for (const reference of resetBinding.references) {
    const parent = reference.identifier.parent;
    const effectOwner = findEnclosingFunction(reference.identifier);
    const effectCall = effectOwner?.parent;
    const isEffectCallback =
      isFunctionLike(effectOwner) &&
      !effectOwner.async &&
      !effectOwner.generator &&
      isNodeOfType(effectCall, "CallExpression") &&
      effectCall.arguments.length === RECORD_FIELD_COUNT &&
      canonicalReactCall(effectCall, "useEffect", context) &&
      effectCall.arguments.at(EMPTY_ARGUMENT_COUNT) === effectOwner;
    const dependencyCall = parent?.parent;
    const isDependency =
      isNodeOfType(parent, "ArrayExpression") &&
      isNodeOfType(dependencyCall, "CallExpression") &&
      (canonicalReactCall(dependencyCall, "useEffect", context) ||
        canonicalReactCall(dependencyCall, "useCallback", context)) &&
      dependencyCall.arguments.at(SINGLE_ARGUMENT_COUNT) === parent;
    if (
      isDependency ||
      (isEffectCallback &&
        ((isNodeOfType(parent, "CallExpression") &&
          parent.callee === reference.identifier &&
          parent.arguments.length === EMPTY_ARGUMENT_COUNT) ||
          (isNodeOfType(parent, "ReturnStatement") && parent.argument === reference.identifier) ||
          (isFunctionLike(parent) && parent.body === reference.identifier)))
    )
      certificate.allowedReferences.add(reference.identifier);
    else return false;
  }
  const functions: EsTreeNode[] = [];
  walkAst(component, (node) => {
    if (node !== component && isFunctionLike(node) && findEnclosingFunction(node) === component)
      functions.push(node);
  });
  for (const candidate of functions) attemptCertificate(candidate, certificate, removalFunction);
  const insertions: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(component, (node) => {
    if (registryCall(node, "set", RECORD_FIELD_COUNT, certificate)) insertions.push(node);
  });
  if (
    insertions.length === EMPTY_ARGUMENT_COUNT ||
    !insertions.every((call) => insertion(call, certificate))
  )
    return false;
  for (const candidate of functions) {
    const binding = functionBindingSymbol(candidate, context);
    if (!binding || !certificate.removalFunctions.has(binding))
      attemptCertificate(candidate, certificate, cancellationFunction);
  }
  let valid = true;
  walkAst(component, (node) => {
    if (isTypeScriptTypePosition(node)) return false;
    if (isSetterCall(node, certificate)) {
      if (!certificate.stateWrites.has(node)) valid = false;
      else certificate.allowedReferences.add(node.callee);
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      refCurrent(node.callee.object, registry, certificate)
    ) {
      if (certificate.registryCalls.has(node)) return;
      const name = getStaticPropertyName(node.callee);
      if ((name === "get" || name === "has") && node.arguments.length === SINGLE_ARGUMENT_COUNT) {
        const [key] = node.arguments;
        const ownerInsertion = certificate.insertionFunctions.get(
          findEnclosingFunction(node) ?? node,
        );
        const declaration = node.parent;
        const next = declaration?.parent?.parent;
        const guard = isNodeOfType(node.parent, "IfStatement") ? node.parent : null;
        if (
          key &&
          ownerInsertion &&
          sameBinding(key, ownerInsertion.key, certificate) &&
          ((guard && bareReturn(guard.consequent) && !guard.alternate) ||
            (isNodeOfType(declaration, "VariableDeclarator") &&
              isNodeOfType(declaration.id, "Identifier") &&
              isNodeOfType(next, "BlockStatement") &&
              next.body.some(
                (statement) =>
                  isNodeOfType(statement, "IfStatement") &&
                  sameBinding(statement.test, declaration.id, certificate) &&
                  bareReturn(statement.consequent),
              )))
        ) {
          acceptRegistryCall(node, certificate);
          if (
            isNodeOfType(declaration, "VariableDeclarator") &&
            isNodeOfType(declaration.id, "Identifier")
          ) {
            trackBinding(declaration.id, certificate);
            for (const reference of symbolFor(declaration.id, certificate)?.references ?? []) {
              if (
                isNodeOfType(reference.identifier.parent, "IfStatement") &&
                reference.identifier.parent.test === reference.identifier
              )
                certificate.allowedReferences.add(reference.identifier);
            }
          }
        }
      }
    }
  });
  for (const reference of pair.stateSymbol.references) {
    const member = reference.identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier ||
      isWithinAssignmentTarget(member) ||
      !methodCall(member.parent, "has", SINGLE_ARGUMENT_COUNT) ||
      member.parent.callee !== member
    )
      return false;
  }
  for (const symbol of certificate.controlledSymbols) {
    for (const reference of symbol.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      if (
        (reference.flag !== "read" && !certificate.allowedUpdates.has(reference.identifier)) ||
        !certificate.allowedReferences.has(reference.identifier)
      )
        return false;
    }
  }
  return valid;
};

const attemptCertificate = (
  owner: EsTreeNode,
  certificate: ControllerRecordCertificate,
  recognize: (owner: EsTreeNode, certificate: ControllerRecordCertificate) => boolean,
): void => {
  const attempt: ControllerRecordCertificate = {
    ...certificate,
    allowedReferences: new Set(certificate.allowedReferences),
    allowedUpdates: new Set(certificate.allowedUpdates),
    controlledSymbols: new Set(certificate.controlledSymbols),
    registryCalls: new Set(certificate.registryCalls),
    stateWrites: new Set(certificate.stateWrites),
    removalFunctions: new Map(certificate.removalFunctions),
    insertionFunctions: new Map(certificate.insertionFunctions),
  };
  if (recognize(owner, attempt)) Object.assign(certificate, attempt);
};

const functionBindingSymbol = (
  owner: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const parent = owner.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier"))
    return context.scopes.symbolFor(parent.id);
  return null;
};

interface TokenMapCertificate extends ControllerRecordCertificate {
  tokenRegistry: SymbolDescriptor;
  mark: SymbolDescriptor;
  clear: SymbolDescriptor;
  stale: SymbolDescriptor;
}

const tokenParameter = (
  node: EsTreeNode | null | undefined,
  keyword: string,
  certificate: TokenMapCertificate,
): node is EsTreeNodeOfType<"Identifier"> => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = symbolFor(node, certificate);
  return Boolean(
    symbol?.kind === "parameter" &&
    parameterAnnotation(node, certificate) === keyword &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const emptyRecord = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "ObjectExpression") && node.properties.length === EMPTY_ARGUMENT_COUNT;

const tokenStoreCall = (
  node: EsTreeNode | null | undefined,
  store: SymbolDescriptor,
  name: string,
  argumentCount: number,
  certificate: TokenMapCertificate,
): node is EsTreeNodeOfType<"CallExpression"> =>
  methodCall(node, name, argumentCount) &&
  isNodeOfType(node.callee, "MemberExpression") &&
  refCurrent(node.callee.object, store, certificate);

const tokenHelperCall = (
  node: EsTreeNode | null | undefined,
  helper: SymbolDescriptor,
  argumentsToMatch: readonly EsTreeNode[],
  certificate: TokenMapCertificate,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "Identifier") &&
  symbolFor(node.callee, certificate) === helper &&
  node.arguments.length === argumentsToMatch.length &&
  node.arguments.every((argument, index) =>
    sameBinding(argument, argumentsToMatch[index], certificate),
  );

const recordAddition = (
  call: EsTreeNodeOfType<"CallExpression">,
  key: EsTreeNode,
  token: EsTreeNode,
  certificate: TokenMapCertificate,
): boolean => {
  const [updater] = call.arguments;
  if (
    !isFunctionLike(updater) ||
    updater.async ||
    updater.generator ||
    updater.params.length !== SINGLE_ARGUMENT_COUNT
  )
    return false;
  const [previous] = updater.params;
  const body = stripParenExpression(updater.body);
  if (
    !isNodeOfType(previous, "Identifier") ||
    !isNodeOfType(body, "ObjectExpression") ||
    body.properties.length !== RECORD_FIELD_COUNT
  )
    return false;
  const [spread, property] = body.properties;
  if (
    !isNodeOfType(spread, "SpreadElement") ||
    !sameBinding(spread.argument, previous, certificate) ||
    !isNodeOfType(property, "Property") ||
    !property.computed ||
    property.kind !== "init" ||
    property.method ||
    !sameBinding(property.key, key, certificate) ||
    !sameBinding(property.value, token, certificate) ||
    !trackBinding(previous, certificate)
  )
    return false;
  allowReferencesIn(body, certificate);
  certificate.stateWrites.add(call);
  return true;
};

const recordDeletion = (
  call: EsTreeNodeOfType<"CallExpression">,
  key: EsTreeNode,
  certificate: TokenMapCertificate,
): boolean => {
  const [updater] = call.arguments;
  if (
    !isFunctionLike(updater) ||
    updater.async ||
    updater.generator ||
    updater.params.length !== SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(updater.body, "BlockStatement")
  )
    return false;
  const [previous] = updater.params;
  if (!isNodeOfType(previous, "Identifier")) return false;
  const statements = [...updater.body.body];
  const [guard] = statements;
  if (isNodeOfType(guard, "IfStatement")) {
    const test = stripParenExpression(guard.test);
    const membership = isNodeOfType(test, "UnaryExpression")
      ? stripParenExpression(test.argument)
      : null;
    if (
      guard.alternate ||
      !isNodeOfType(test, "UnaryExpression") ||
      test.operator !== "!" ||
      !isNodeOfType(membership, "BinaryExpression") ||
      membership.operator !== "in" ||
      !sameBinding(membership.left, key, certificate) ||
      !sameBinding(membership.right, previous, certificate) ||
      !isNodeOfType(guard.consequent, "ReturnStatement") ||
      !sameBinding(guard.consequent.argument, previous, certificate)
    )
      return false;
    statements.shift();
  }
  const [copyStatement, deleteStatement, returnStatement] = statements;
  const copy = singleDeclaration(copyStatement);
  const removal = expressionStatement(deleteStatement);
  if (
    statements.length !== RESET_STATEMENT_COUNT ||
    !copy ||
    !isNodeOfType(copy.id, "Identifier") ||
    !isNodeOfType(copy.init, "ObjectExpression") ||
    copy.init.properties.length !== SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(copy.init.properties[EMPTY_ARGUMENT_COUNT], "SpreadElement") ||
    !sameBinding(copy.init.properties[EMPTY_ARGUMENT_COUNT].argument, previous, certificate) ||
    !isNodeOfType(removal, "UnaryExpression") ||
    removal.operator !== "delete" ||
    !isNodeOfType(removal.argument, "MemberExpression") ||
    !removal.argument.computed ||
    removal.argument.optional ||
    !sameBinding(removal.argument.object, copy.id, certificate) ||
    !sameBinding(removal.argument.property, key, certificate) ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !sameBinding(returnStatement.argument, copy.id, certificate) ||
    !trackBinding(previous, certificate)
  )
    return false;
  const copySymbol = symbolFor(copy.id, certificate);
  if (
    copySymbol?.kind !== "const" ||
    copySymbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  certificate.controlledSymbols.add(copySymbol);
  allowReferencesIn(updater.body, certificate);
  certificate.stateWrites.add(call);
  return true;
};

const tokenRecordWriter = (
  call: EsTreeNodeOfType<"CallExpression">,
  certificate: TokenMapCertificate,
): boolean => {
  const updater = call.arguments.at(EMPTY_ARGUMENT_COUNT);
  const owner = findEnclosingFunction(call);
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(owner.body, "BlockStatement")
  )
    return false;
  const binding = functionBinding(owner, certificate);
  const [key, token] = owner.params;
  if (!binding || !tokenParameter(key, "TSStringKeyword", certificate)) return false;
  const statements = owner.body.body;
  if (
    isFunctionLike(updater) &&
    isNodeOfType(stripParenExpression(updater.body), "ObjectExpression")
  ) {
    const insertion = expressionStatement(statements.at(EMPTY_ARGUMENT_COUNT));
    if (
      certificate.mark !== certificate.setter ||
      owner.params.length !== RECORD_FIELD_COUNT ||
      !tokenParameter(token, "TSNumberKeyword", certificate) ||
      statements.length !== RECORD_FIELD_COUNT ||
      expressionStatement(statements.at(SINGLE_ARGUMENT_COUNT)) !== call ||
      !tokenStoreCall(
        insertion,
        certificate.tokenRegistry,
        "set",
        RECORD_FIELD_COUNT,
        certificate,
      ) ||
      !sameBinding(insertion.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
      !sameBinding(insertion.arguments.at(SINGLE_ARGUMENT_COUNT), token, certificate) ||
      !recordAddition(call, key, token, certificate)
    )
      return false;
    certificate.mark = binding;
    acceptRegistryCall(insertion, certificate);
  } else {
    const tokenDeletion = expressionStatement(statements.at(EMPTY_ARGUMENT_COUNT));
    const controllerDeletion = expressionStatement(statements.at(SINGLE_ARGUMENT_COUNT));
    if (
      certificate.clear !== certificate.setter ||
      owner.params.length !== SINGLE_ARGUMENT_COUNT ||
      statements.length !== RESET_STATEMENT_COUNT ||
      expressionStatement(statements.at(RECORD_FIELD_COUNT)) !== call ||
      !tokenStoreCall(
        tokenDeletion,
        certificate.tokenRegistry,
        "delete",
        SINGLE_ARGUMENT_COUNT,
        certificate,
      ) ||
      !tokenStoreCall(
        controllerDeletion,
        certificate.registry,
        "delete",
        SINGLE_ARGUMENT_COUNT,
        certificate,
      ) ||
      !sameBinding(tokenDeletion.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
      !sameBinding(controllerDeletion.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
      !recordDeletion(call, key, certificate)
    )
      return false;
    certificate.clear = binding;
    acceptRegistryCall(tokenDeletion, certificate);
    acceptRegistryCall(controllerDeletion, certificate);
  }
  return true;
};

const tokenRelease = (
  statements: readonly EsTreeNode[],
  certificate: TokenMapCertificate,
): boolean => {
  const [tokenStatement, releaseStatement, controllerStatement] = statements;
  const tokenClear = expressionStatement(tokenStatement);
  const release = expressionStatement(releaseStatement);
  const controllerClear = expressionStatement(controllerStatement);
  if (
    statements.length !== RESET_STATEMENT_COUNT ||
    !tokenStoreCall(
      tokenClear,
      certificate.tokenRegistry,
      "clear",
      EMPTY_ARGUMENT_COUNT,
      certificate,
    ) ||
    !tokenStoreCall(release, certificate.registry, "forEach", SINGLE_ARGUMENT_COUNT, certificate) ||
    !tokenStoreCall(
      controllerClear,
      certificate.registry,
      "clear",
      EMPTY_ARGUMENT_COUNT,
      certificate,
    )
  )
    return false;
  const [callback] = release.arguments;
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== SINGLE_ARGUMENT_COUNT
  )
    return false;
  const [controller] = callback.params;
  const body = stripParenExpression(callback.body);
  const abort =
    isNodeOfType(body, "BlockStatement") && body.body.length === SINGLE_ARGUMENT_COUNT
      ? expressionStatement(body.body.at(EMPTY_ARGUMENT_COUNT))
      : body;
  if (
    !isNodeOfType(controller, "Identifier") ||
    !trackBinding(controller, certificate) ||
    !abortCall(abort, controller, certificate)
  )
    return false;
  acceptRegistryCall(tokenClear, certificate);
  acceptRegistryCall(release, certificate);
  acceptRegistryCall(controllerClear, certificate);
  return true;
};

const tokenMembershipGuard = (
  statement: EsTreeNode | null | undefined,
  key: EsTreeNode,
  negate: boolean,
  certificate: TokenMapCertificate,
): boolean => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !bareReturn(statement.consequent)
  )
    return false;
  const test = stripParenExpression(statement.test);
  const lookup =
    negate && isNodeOfType(test, "UnaryExpression") && test.operator === "!"
      ? stripParenExpression(test.argument)
      : test;
  if (
    (negate && lookup === test) ||
    !tokenStoreCall(lookup, certificate.tokenRegistry, "has", SINGLE_ARGUMENT_COUNT, certificate) ||
    !sameBinding(lookup.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate)
  )
    return false;
  acceptRegistryCall(lookup, certificate);
  return true;
};

const tokenStaleHelper = (owner: EsTreeNode, certificate: TokenMapCertificate): boolean => {
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== RECORD_FIELD_COUNT
  )
    return false;
  const [key, token] = owner.params;
  const body = stripParenExpression(owner.body);
  const result =
    isNodeOfType(body, "BlockStatement") &&
    body.body.length === SINGLE_ARGUMENT_COUNT &&
    isNodeOfType(body.body[EMPTY_ARGUMENT_COUNT], "ReturnStatement")
      ? body.body[EMPTY_ARGUMENT_COUNT].argument
      : body;
  if (
    !tokenParameter(key, "TSStringKeyword", certificate) ||
    !tokenParameter(token, "TSNumberKeyword", certificate) ||
    !isNodeOfType(result, "BinaryExpression") ||
    result.operator !== "!==" ||
    !tokenStoreCall(
      result.left,
      certificate.tokenRegistry,
      "get",
      SINGLE_ARGUMENT_COUNT,
      certificate,
    ) ||
    !sameBinding(result.left.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
    !sameBinding(result.right, token, certificate)
  )
    return false;
  const binding = functionBinding(owner, certificate);
  if (!binding || certificate.stale !== certificate.setter) return false;
  certificate.stale = binding;
  acceptRegistryCall(result.left, certificate);
  return true;
};

const tokenSettlement = (
  guard: EsTreeNode | null | undefined,
  clear: EsTreeNode | null | undefined,
  key: EsTreeNode,
  token: EsTreeNode,
  certificate: TokenMapCertificate,
): boolean => {
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !bareReturn(guard.consequent) ||
    !tokenHelperCall(stripParenExpression(guard.test), certificate.stale, [key, token], certificate)
  )
    return false;
  const removal = expressionStatement(clear);
  if (!tokenHelperCall(removal, certificate.clear, [key], certificate)) return false;
  allowReferencesIn(guard.test, certificate);
  allowReferencesIn(removal, certificate);
  return true;
};

const hasDirectAwait = (statement: EsTreeNode | null | undefined): boolean => {
  const value = statement
    ? (expressionStatement(statement) ?? singleDeclaration(statement)?.init)
    : null;
  const expression = value ? stripParenExpression(value) : null;
  const awaited =
    isNodeOfType(expression, "AssignmentExpression") && expression.operator === "="
      ? stripParenExpression(expression.right)
      : expression;
  return isNodeOfType(awaited, "AwaitExpression");
};

const tokenRequest = (
  call: EsTreeNodeOfType<"CallExpression">,
  certificate: TokenMapCertificate,
): boolean => {
  const [key, controller] = call.arguments;
  const owner = findEnclosingFunction(call);
  if (
    !key ||
    !isNodeOfType(controller, "Identifier") ||
    !tokenParameter(key, "TSStringKeyword", certificate) ||
    !isFunctionLike(owner) ||
    !owner.async ||
    owner.generator ||
    owner.params.length < SINGLE_ARGUMENT_COUNT ||
    owner.params.length > RECORD_FIELD_COUNT ||
    !owner.params.every((parameter) => tokenParameter(parameter, "TSStringKeyword", certificate)) ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    call.parent?.parent !== owner.body ||
    findEnclosingFunction(symbolFor(key, certificate)?.bindingIdentifier ?? call) !== owner ||
    !controllerOrigin(controller, certificate)
  )
    return false;
  const block = owner.body;
  const position = block.body.findIndex((statement) => expressionStatement(statement) === call);
  const mark = expressionStatement(block.body.at(position + SINGLE_ARGUMENT_COUNT));
  const token = isNodeOfType(mark, "CallExpression")
    ? mark.arguments.at(SINGLE_ARGUMENT_COUNT)
    : null;
  const tokenSymbol = token ? symbolFor(token, certificate) : null;
  const update = tokenSymbol?.initializer;
  const counter = isNodeOfType(update, "UpdateExpression") ? update.argument : null;
  const counterSymbol = isNodeOfType(counter, "MemberExpression")
    ? symbolFor(counter.object, certificate)
    : null;
  const counterInitializer = counterSymbol?.initializer;
  const counterInitialValue = isNodeOfType(counterInitializer, "CallExpression")
    ? counterInitializer.arguments.at(EMPTY_ARGUMENT_COUNT)
    : null;
  if (
    !token ||
    !tokenHelperCall(mark, certificate.mark, [key, token], certificate) ||
    !trackBinding(token, certificate) ||
    tokenSymbol?.kind !== "const" ||
    findEnclosingFunction(tokenSymbol.declarationNode) !== owner ||
    !isNodeOfType(update, "UpdateExpression") ||
    update.operator !== "++" ||
    !update.prefix ||
    !counter ||
    !counterSymbol ||
    counterSymbol.kind !== "const" ||
    findEnclosingFunction(counterSymbol.declarationNode) !== certificate.component ||
    !refCurrent(counter, counterSymbol, certificate) ||
    !isNodeOfType(counterInitializer, "CallExpression") ||
    !canonicalReactCall(counterInitializer, "useRef", certificate.context) ||
    counterInitializer.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(counterInitialValue, "Literal") ||
    counterInitialValue.value !== EMPTY_ARGUMENT_COUNT ||
    findEnclosingFunction(
      resolveConstIdentifierAlias(controller, certificate.context.scopes)?.declarationNode ?? call,
    ) !== owner ||
    !tokenMembershipGuard(block.body.at(EMPTY_ARGUMENT_COUNT), key, false, certificate)
  )
    return false;
  const controllerRoot = resolveConstIdentifierAlias(controller, certificate.context.scopes);
  for (const statement of block.body.slice(SINGLE_ARGUMENT_COUNT, position)) {
    const declaration = singleDeclaration(statement);
    const binding =
      declaration && isNodeOfType(declaration.id, "Identifier")
        ? symbolFor(declaration.id, certificate)
        : null;
    if (
      !binding ||
      (binding !== tokenSymbol &&
        binding !== controllerRoot &&
        !certificate.controlledSymbols.has(binding))
    )
      return false;
  }
  let requestPosition = position + RECORD_FIELD_COUNT;
  while (isNodeOfType(block.body.at(requestPosition), "VariableDeclaration")) {
    const statement = block.body.at(requestPosition);
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.declarations.some((declaration) => declaration.init)
    )
      return false;
    requestPosition += SINGLE_ARGUMENT_COUNT;
  }
  const request = block.body.at(requestPosition);
  if (!isNodeOfType(request, "TryStatement") || request.finalizer || !request.handler) return false;
  const tryStatements = request.block.body;
  const awaitPosition = tryStatements.findIndex(hasDirectAwait);
  if (awaitPosition !== EMPTY_ARGUMENT_COUNT) return false;
  const catchStatements = request.handler.body.body;
  if (
    !tokenSettlement(
      catchStatements.at(EMPTY_ARGUMENT_COUNT),
      catchStatements.at(SINGLE_ARGUMENT_COUNT),
      key,
      token,
      certificate,
    )
  )
    return false;
  if (tryStatements.length === RESET_STATEMENT_COUNT) {
    if (
      !tokenSettlement(
        tryStatements.at(SINGLE_ARGUMENT_COUNT),
        tryStatements.at(RECORD_FIELD_COUNT),
        key,
        token,
        certificate,
      )
    )
      return false;
  } else if (tryStatements.length === SINGLE_ARGUMENT_COUNT) {
    const catchLast = catchStatements.at(-SINGLE_ARGUMENT_COUNT);
    if (
      !bareReturn(catchLast) ||
      !tokenSettlement(
        block.body.at(requestPosition + SINGLE_ARGUMENT_COUNT),
        block.body.at(requestPosition + RECORD_FIELD_COUNT),
        key,
        token,
        certificate,
      )
    )
      return false;
  } else return false;
  const binding = functionBinding(owner, certificate);
  if (!binding) return false;
  for (const reference of binding.references) {
    const parent = reference.identifier.parent;
    if (
      !isNodeOfType(parent, "CallExpression") ||
      parent.callee !== reference.identifier ||
      parent.optional ||
      parent.arguments.length !== owner.params.length
    )
      return false;
    certificate.allowedReferences.add(reference.identifier);
  }
  certificate.controlledSymbols.add(counterSymbol);
  if (isNodeOfType(counter, "MemberExpression")) certificate.allowedUpdates.add(counter.object);
  allowReferencesIn(update, certificate);
  allowReferencesIn(mark, certificate);
  acceptRegistryCall(call, certificate);
  return true;
};

const tokenCancellation = (owner: EsTreeNode, certificate: TokenMapCertificate): boolean => {
  if (
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.body.body.length !== RESET_STATEMENT_COUNT
  )
    return false;
  const [key] = owner.params;
  const [guard, abortStatement, clearStatement] = owner.body.body;
  const abort = expressionStatement(abortStatement);
  const getter =
    isNodeOfType(abort, "CallExpression") && isNodeOfType(abort.callee, "MemberExpression")
      ? stripParenExpression(abort.callee.object)
      : null;
  if (
    !tokenParameter(key, "TSStringKeyword", certificate) ||
    !tokenMembershipGuard(guard, key, true, certificate) ||
    !isNodeOfType(abort, "CallExpression") ||
    !isNodeOfType(abort.callee, "MemberExpression") ||
    abort.arguments.length !== EMPTY_ARGUMENT_COUNT ||
    abort.callee.computed ||
    getStaticPropertyName(abort.callee) !== "abort" ||
    abort.optional ||
    !abort.callee.optional ||
    !tokenStoreCall(getter, certificate.registry, "get", SINGLE_ARGUMENT_COUNT, certificate) ||
    !sameBinding(getter.arguments.at(EMPTY_ARGUMENT_COUNT), key, certificate) ||
    !tokenHelperCall(expressionStatement(clearStatement), certificate.clear, [key], certificate)
  )
    return false;
  const binding = functionBinding(owner, certificate);
  if (!binding) return false;
  acceptRegistryCall(getter, certificate);
  if (clearStatement) allowReferencesIn(clearStatement, certificate);
  for (const reference of binding.references) {
    const parent = reference.identifier.parent;
    if (
      !isNodeOfType(parent, "CallExpression") ||
      parent.callee !== reference.identifier ||
      parent.optional ||
      parent.arguments.length !== SINGLE_ARGUMENT_COUNT
    )
      return false;
    certificate.allowedReferences.add(reference.identifier);
  }
  return true;
};

const hasTokenComputedProviderUse = (member: EsTreeNode, context: RuleContext): boolean => {
  const pending: EsTreeNode[] = [member];
  const visited = new Set<SymbolDescriptor>();
  while (pending.length > EMPTY_ARGUMENT_COUNT) {
    const current = pending.pop();
    if (!current) continue;
    const value = findTransparentExpressionRoot(current);
    const parent = value.parent;
    if (
      ((isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
        parent.callee === value) ||
      (isNodeOfType(parent, "MemberExpression") && parent.object === value)
    )
      return true;
    if (
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === value || parent.right === value)) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === value || parent.alternate === value))
    ) {
      pending.push(parent);
    } else if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === value &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(parent.id);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        symbol.references.some((reference) => reference.flag !== "read")
      )
        return true;
      if (!visited.has(symbol)) {
        visited.add(symbol);
        for (const reference of symbol.references) pending.push(reference.identifier);
      }
    }
  }
  return false;
};

interface TokenMapComponentIndex {
  staleHelpers: Map<SymbolDescriptor, EsTreeNode[]>;
  cancellationHelpers: Map<SymbolDescriptor, EsTreeNode[]>;
  insertions: Map<SymbolDescriptor, EsTreeNodeOfType<"CallExpression">[]>;
  cleanups: Map<SymbolDescriptor, EsTreeNode[]>;
}

const supportedTokenPrograms = new WeakMap<ScopeAnalysis, boolean>();
const tokenMapComponents = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, TokenMapComponentIndex>
>();

const supportedTokenProgram = (program: EsTreeNode, context: RuleContext): boolean => {
  const cached = supportedTokenPrograms.get(context.scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      ((isMemberMutationTarget(node) &&
        (getStaticPropertyName(node) === "useState" ||
          getStaticPropertyName(node) === "useRef" ||
          getStaticPropertyName(node) === "useEffect" ||
          getStaticPropertyName(node) === "useCallback") &&
        isLoadedReactProvider(node.object, context, true)) ||
        (node.computed &&
          getResolvedStaticPropertyName(node, context.scopes, {
            allowConstTemplateLiteral: true,
            allowConstNumericLiteral: true,
            stringifyNonStringLiterals: true,
          }) === null &&
          hasTokenComputedProviderUse(node, context)))
    )
      supported = false;
  });
  supportedTokenPrograms.set(context.scopes, supported);
  return supported;
};

const indexTokenMapComponent = (
  component: EsTreeNode,
  context: RuleContext,
): TokenMapComponentIndex => {
  let components = tokenMapComponents.get(context.scopes);
  if (!components) {
    components = new WeakMap();
    tokenMapComponents.set(context.scopes, components);
  }
  const cached = components.get(component);
  if (cached) return cached;
  const index: TokenMapComponentIndex = {
    staleHelpers: new Map(),
    cancellationHelpers: new Map(),
    insertions: new Map(),
    cleanups: new Map(),
  };
  const storeForCall = (call: EsTreeNode | null | undefined): SymbolDescriptor | null => {
    if (!isNodeOfType(call, "CallExpression") || !isNodeOfType(call.callee, "MemberExpression"))
      return null;
    const receiver = call.callee.object;
    return isNodeOfType(receiver, "MemberExpression") &&
      !receiver.computed &&
      !receiver.optional &&
      getStaticPropertyName(receiver) === "current" &&
      isNodeOfType(receiver.object, "Identifier")
      ? context.scopes.symbolFor(receiver.object)
      : null;
  };
  walkAst(component, (node) => {
    if (methodCall(node, "set", RECORD_FIELD_COUNT)) {
      const symbol = storeForCall(node);
      if (symbol) {
        const calls = index.insertions.get(symbol) ?? [];
        calls.push(node);
        index.insertions.set(symbol, calls);
      }
    }
    if (!isFunctionLike(node)) return;
    const body = stripParenExpression(node.body);
    if (findEnclosingFunction(node) === component) {
      if (
        isNodeOfType(body, "BinaryExpression") &&
        body.operator === "!==" &&
        methodCall(body.left, "get", SINGLE_ARGUMENT_COUNT)
      ) {
        const symbol = storeForCall(body.left);
        if (symbol) {
          const functions = index.staleHelpers.get(symbol) ?? [];
          functions.push(node);
          index.staleHelpers.set(symbol, functions);
        }
      }
      const first = isNodeOfType(body, "BlockStatement")
        ? body.body.at(EMPTY_ARGUMENT_COUNT)
        : null;
      const guard = isNodeOfType(first, "IfStatement") ? stripParenExpression(first.test) : null;
      const membership = isNodeOfType(guard, "UnaryExpression")
        ? stripParenExpression(guard.argument)
        : null;
      if (
        node.params.length === SINGLE_ARGUMENT_COUNT &&
        methodCall(membership, "has", SINGLE_ARGUMENT_COUNT)
      ) {
        const symbol = storeForCall(membership);
        if (symbol) {
          const functions = index.cancellationHelpers.get(symbol) ?? [];
          functions.push(node);
          index.cancellationHelpers.set(symbol, functions);
        }
      }
    }
    const first = isNodeOfType(body, "BlockStatement")
      ? expressionStatement(body.body.at(EMPTY_ARGUMENT_COUNT))
      : null;
    if (methodCall(first, "clear", EMPTY_ARGUMENT_COUNT)) {
      const symbol = storeForCall(first);
      if (symbol) {
        const functions = index.cleanups.get(symbol) ?? [];
        functions.push(node);
        index.cleanups.set(symbol, functions);
      }
    }
  });
  components.set(component, index);
  return index;
};

const certifyOwnedTokenMapRecordReset = (write: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    write.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !emptyRecord(write.arguments.at(EMPTY_ARGUMENT_COUNT))
  )
    return false;
  const pair = resolveReactUseStatePair(write.callee, context.scopes);
  const component = pair ? findEnclosingFunction(pair.declarator) : null;
  const owner = findEnclosingFunction(write);
  const program = findProgramRoot(write);
  if (
    !pair?.stateSymbol ||
    pair.stateSymbol.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    !component ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    owner.params.length !== EMPTY_ARGUMENT_COUNT ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    owner.body.body.length !== REMOVAL_STATEMENT_COUNT ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !canonicalReactCall(pair.declarator.init, "useState", context) ||
    pair.declarator.init.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    !emptyRecord(pair.declarator.init.arguments.at(EMPTY_ARGUMENT_COUNT)) ||
    !program ||
    !supportedProgram(program, context)
  )
    return false;
  if (!supportedTokenProgram(program, context)) return false;
  const [tokenStatement, releaseStatement, , resetStatement] = owner.body.body;
  const tokenClear = expressionStatement(tokenStatement);
  const release = expressionStatement(releaseStatement);
  if (
    expressionStatement(resetStatement) !== write ||
    !methodCall(tokenClear, "clear", EMPTY_ARGUMENT_COUNT) ||
    !isNodeOfType(tokenClear.callee, "MemberExpression") ||
    !methodCall(release, "forEach", SINGLE_ARGUMENT_COUNT) ||
    !isNodeOfType(release.callee, "MemberExpression")
  )
    return false;
  const certificate: TokenMapCertificate = {
    context,
    component,
    registry: pair.setterSymbol,
    tokenRegistry: pair.setterSymbol,
    setter: pair.setterSymbol,
    mark: pair.setterSymbol,
    clear: pair.setterSymbol,
    stale: pair.setterSymbol,
    allowedReferences: new Set(),
    allowedUpdates: new Set(),
    controlledSymbols: new Set([pair.setterSymbol]),
    registryCalls: new Set(),
    stateWrites: new Set([write]),
    removalFunctions: new Map(),
    insertionFunctions: new Map(),
  };
  const tokenRegistry = directRef(tokenClear.callee.object, certificate);
  const controllerRegistry = directRef(release.callee.object, certificate);
  if (!tokenRegistry || !controllerRegistry || tokenRegistry === controllerRegistry) return false;
  certificate.registry = controllerRegistry;
  certificate.tokenRegistry = tokenRegistry;
  if (
    !trackBinding(tokenRegistry.bindingIdentifier, certificate) ||
    !trackBinding(controllerRegistry.bindingIdentifier, certificate) ||
    !tokenRelease(owner.body.body.slice(EMPTY_ARGUMENT_COUNT, RESET_STATEMENT_COUNT), certificate)
  )
    return false;
  const resetBinding = functionBinding(owner, certificate);
  if (!resetBinding) return false;
  for (const reference of resetBinding.references) {
    const parent = reference.identifier.parent;
    const effect = findEnclosingFunction(reference.identifier);
    const call = effect?.parent;
    const dependency = parent?.parent;
    if (
      (isNodeOfType(parent, "ArrayExpression") &&
        isNodeOfType(dependency, "CallExpression") &&
        (canonicalReactCall(dependency, "useEffect", context) ||
          canonicalReactCall(dependency, "useCallback", context)) &&
        dependency.arguments.at(SINGLE_ARGUMENT_COUNT) === parent) ||
      (isFunctionLike(effect) &&
        !effect.async &&
        !effect.generator &&
        effect.params.length === EMPTY_ARGUMENT_COUNT &&
        isNodeOfType(call, "CallExpression") &&
        canonicalReactCall(call, "useEffect", context) &&
        call.arguments.length === RECORD_FIELD_COUNT &&
        call.arguments.at(EMPTY_ARGUMENT_COUNT) === effect &&
        isNodeOfType(parent, "CallExpression") &&
        parent.callee === reference.identifier &&
        parent.arguments.length === EMPTY_ARGUMENT_COUNT &&
        !parent.optional)
    )
      certificate.allowedReferences.add(reference.identifier);
    else return false;
  }
  const componentIndex = indexTokenMapComponent(component, context);
  for (const reference of pair.setterSymbol.references) {
    const call = reference.identifier.parent;
    if (!isSetterCall(call, certificate) || call.callee !== reference.identifier) return false;
    if (call !== write && !tokenRecordWriter(call, certificate)) return false;
    certificate.allowedReferences.add(reference.identifier);
  }
  if (certificate.mark === certificate.setter || certificate.clear === certificate.setter)
    return false;
  for (const candidate of componentIndex.staleHelpers.get(tokenRegistry) ?? []) {
    const body = isFunctionLike(candidate) ? stripParenExpression(candidate.body) : null;
    if (
      isNodeOfType(body, "BinaryExpression") &&
      body.operator === "!==" &&
      tokenStoreCall(body.left, tokenRegistry, "get", SINGLE_ARGUMENT_COUNT, certificate)
    ) {
      if (!tokenStaleHelper(candidate, certificate)) return false;
    }
  }
  if (certificate.stale === certificate.setter) return false;
  const insertions = componentIndex.insertions.get(controllerRegistry) ?? [];
  if (
    insertions.length === EMPTY_ARGUMENT_COUNT ||
    !insertions.every((call) => tokenRequest(call, certificate))
  )
    return false;
  for (const candidate of componentIndex.cancellationHelpers.get(tokenRegistry) ?? []) {
    if (!isFunctionLike(candidate) || !isNodeOfType(candidate.body, "BlockStatement")) continue;
    const first = candidate.body.body.at(EMPTY_ARGUMENT_COUNT);
    if (
      candidate.params.length === SINGLE_ARGUMENT_COUNT &&
      isNodeOfType(first, "IfStatement") &&
      isNodeOfType(stripParenExpression(first.test), "UnaryExpression")
    ) {
      if (!tokenCancellation(candidate, certificate)) return false;
    }
  }
  for (const node of componentIndex.cleanups.get(tokenRegistry) ?? []) {
    if (
      !isFunctionLike(node) ||
      node.async ||
      node.generator ||
      node.params.length !== EMPTY_ARGUMENT_COUNT ||
      !isNodeOfType(node.body, "BlockStatement") ||
      node.body.body.length !== RESET_STATEMENT_COUNT
    )
      continue;
    const first = expressionStatement(node.body.body.at(EMPTY_ARGUMENT_COUNT));
    if (!tokenStoreCall(first, tokenRegistry, "clear", EMPTY_ARGUMENT_COUNT, certificate)) continue;
    const effect = node.parent;
    const effectCallback = isNodeOfType(effect, "ReturnStatement")
      ? findEnclosingFunction(effect)
      : effect;
    const effectCall = effectCallback?.parent;
    if (
      !isFunctionLike(effectCallback) ||
      effectCallback.async ||
      effectCallback.generator ||
      effectCallback.params.length !== EMPTY_ARGUMENT_COUNT ||
      !isNodeOfType(effectCall, "CallExpression") ||
      !canonicalReactCall(effectCall, "useEffect", context) ||
      effectCall.arguments.length !== RECORD_FIELD_COUNT ||
      effectCall.arguments.at(EMPTY_ARGUMENT_COUNT) !== effectCallback ||
      !(
        effectCallback.body === node ||
        (isNodeOfType(effect, "ReturnStatement") && effect.argument === node)
      )
    )
      continue;
    tokenRelease(node.body.body, certificate);
  }
  for (const reference of pair.stateSymbol.references) {
    const member = reference.identifier.parent;
    const comparison = member?.parent;
    const other = isNodeOfType(comparison, "BinaryExpression")
      ? comparison.left === member
        ? comparison.right
        : comparison.left
      : null;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier ||
      member.optional ||
      isWithinAssignmentTarget(member) ||
      !isNodeOfType(comparison, "BinaryExpression") ||
      (comparison.operator !== "===" && comparison.operator !== "!==") ||
      !isNodeOfType(other, "Identifier") ||
      other.name !== "undefined" ||
      !isRuntimeGlobalReference(other, context)
    )
      return false;
  }
  for (const symbol of certificate.controlledSymbols) {
    for (const reference of symbol.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      if (
        (reference.flag !== "read" && !certificate.allowedUpdates.has(reference.identifier)) ||
        !certificate.allowedReferences.has(reference.identifier)
      )
        return false;
    }
  }
  return true;
};

export const isOwnedControllerRecordReset = (write: EsTreeNode, context: RuleContext): boolean => {
  let results = controllerRecordCertificates.get(context.scopes);
  if (!results) {
    results = new WeakMap();
    controllerRecordCertificates.set(context.scopes, results);
  }
  const cached = results.get(write);
  if (cached !== undefined) return cached;
  const result =
    isNodeOfType(write, "CallExpression") && emptyRecord(write.arguments.at(EMPTY_ARGUMENT_COUNT))
      ? certifyOwnedTokenMapRecordReset(write, context)
      : certifyOwnedControllerRecordReset(write, context);
  results.set(write, result);
  return result;
};
