import { isEventHandlerName } from "./event-handler-reference.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { OBJECT_PROTOTYPE_PROPERTY_NAMES } from "../../../utils/constants.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticThisOrAliasFieldName } from "../../../utils/get-static-this-or-alias-field-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNoOpStatement } from "../../../utils/is-no-op-statement.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isProvenReactClassComponent } from "../../../utils/is-proven-react-class-component.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OWNED_INPUT_RESERVED_ATTRIBUTES,
  OWNED_INPUT_EMPTY_COUNT,
  OWNED_INPUT_SINGLE_COUNT,
} from "./constants.js";

export interface OwnedObjectCallbackDataConsumerInput {
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly argument: EsTreeNode;
  readonly module: SourceProjectModule;
  readonly isNativeValue: (value: EsTreeNode) => boolean;
  readonly isKnownCallableReceiver: (value: EsTreeNode) => boolean;
}

const oneDeclaration = (
  node: EsTreeNode | undefined,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  if (!isNodeOfType(node, "VariableDeclaration") || node.kind !== "const") return null;
  const [declaration, ...extra] = node.declarations;
  return declaration && !extra.length ? declaration : null;
};

export const isOwnedObjectCallbackDataConsumer = (
  input: OwnedObjectCallbackDataConsumerInput,
): boolean => {
  const { call, argument, module } = input;
  const scopes = module.scopes;
  const readonly = (symbol: SymbolDescriptor): boolean =>
    !hasSymbolBindingWrites(symbol) &&
    hasCompleteSymbolReferences(symbol, module.programNode, scopes);
  const isSymbol = (raw: EsTreeNode | undefined, symbol: SymbolDescriptor): boolean =>
    Boolean(
      raw &&
      isNodeOfType(stripParenExpression(raw), "Identifier") &&
      scopes.symbolFor(stripParenExpression(raw)) === symbol,
    );
  const callee = stripParenExpression(call.callee);
  const [selectedArgument] = call.arguments;
  if (call.optional || !isNodeOfType(callee, "Identifier") || selectedArgument !== argument)
    return false;
  const binding = scopes.symbolFor(callee);
  const callback = resolveExactLocalFunction(callee, scopes);
  if (
    !binding ||
    !readonly(binding) ||
    !callback ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    findProgramRoot(callback) !== module.programNode ||
    !getFunctionBindingSymbols(callback, scopes).includes(binding)
  )
    return false;
  const callbackRoot = findTransparentExpressionRoot(callback);
  if (
    isNodeOfType(callbackRoot.parent, "ExportDefaultDeclaration") ||
    isNodeOfType(callbackRoot.parent, "ExportNamedDeclaration") ||
    isNodeOfType(callbackRoot.parent?.parent?.parent, "ExportNamedDeclaration")
  )
    return false;
  const [callbackParameter, dataParameter, ...extraParameters] = callback.params;
  if (
    !isNodeOfType(callbackParameter, "Identifier") ||
    !isNodeOfType(dataParameter, "Identifier") ||
    extraParameters.length
  )
    return false;
  const callbackSymbol = scopes.symbolFor(callbackParameter),
    dataSymbol = scopes.symbolFor(dataParameter);
  if (!callbackSymbol || !dataSymbol || !readonly(callbackSymbol) || !readonly(dataSymbol))
    return false;
  const [guard, recordStatement, resultStatement, returnStatement, ...extraStatements] =
    getCallbackStatements(callback);
  if (extraStatements.length || !isNodeOfType(guard, "IfStatement") || guard.alternate)
    return false;
  const test = stripParenExpression(guard.test);
  if (!isNodeOfType(test, "BinaryExpression") || test.operator !== "===") return false;
  const tested = stripParenExpression(test.left),
    typeName = stripParenExpression(test.right);
  if (
    !isNodeOfType(tested, "UnaryExpression") ||
    tested.operator !== "typeof" ||
    !isSymbol(tested.argument, callbackSymbol) ||
    !isNodeOfType(typeName, "Literal") ||
    typeName.value !== "function"
  )
    return false;
  const branch = isNodeOfType(guard.consequent, "BlockStatement")
    ? guard.consequent.body.filter((statement) => !isNoOpStatement(statement))
    : [guard.consequent];
  const [directReturn, ...extraBranch] = branch;
  const directCall =
    isNodeOfType(directReturn, "ReturnStatement") && directReturn.argument
      ? stripParenExpression(directReturn.argument)
      : null;
  const matchesCall = (
    node: EsTreeNode | null,
    receiver: SymbolDescriptor,
  ): node is EsTreeNodeOfType<"CallExpression"> => {
    if (!isNodeOfType(node, "CallExpression") || node.optional || !isSymbol(node.callee, receiver))
      return false;
    const [data, ...extra] = node.arguments;
    return Boolean(data && !extra.length && isSymbol(data, dataSymbol));
  };
  if (extraBranch.length || !matchesCall(directCall, callbackSymbol)) return false;
  const record = oneDeclaration(recordStatement),
    result = oneDeclaration(resultStatement);
  if (
    !record ||
    !record.init ||
    !isSymbol(record.init, callbackSymbol) ||
    !isNodeOfType(record.id, "ObjectPattern") ||
    !result ||
    !result.init ||
    !isNodeOfType(result.id, "Identifier")
  )
    return false;
  const [firstSlot, secondSlot, ...extraSlots] = record.id.properties;
  if (
    extraSlots.length ||
    !isNodeOfType(firstSlot, "Property") ||
    !isNodeOfType(secondSlot, "Property") ||
    firstSlot.kind !== "init" ||
    secondSlot.kind !== "init" ||
    firstSlot.method ||
    secondSlot.method ||
    !isNodeOfType(firstSlot.value, "Identifier") ||
    !isNodeOfType(secondSlot.value, "Identifier")
  )
    return false;
  const firstName = getStaticPropertyKeyName(firstSlot, { allowComputedString: true }),
    secondName = getStaticPropertyKeyName(secondSlot, { allowComputedString: true });
  if (
    !firstName ||
    !secondName ||
    firstName === secondName ||
    OBJECT_PROTOTYPE_PROPERTY_NAMES.has(firstName) ||
    OBJECT_PROTOTYPE_PROPERTY_NAMES.has(secondName)
  )
    return false;
  const firstSymbol = scopes.symbolFor(firstSlot.value),
    secondSymbol = scopes.symbolFor(secondSlot.value),
    resultSymbol = scopes.symbolFor(result.id);
  const recordCall = stripParenExpression(result.init);
  const recordFunction =
    firstSymbol && matchesCall(recordCall, firstSymbol)
      ? firstSymbol
      : secondSymbol && matchesCall(recordCall, secondSymbol)
        ? secondSymbol
        : null;
  const errorSymbol = recordFunction === firstSymbol ? secondSymbol : firstSymbol;
  if (
    !recordFunction ||
    !errorSymbol ||
    !resultSymbol ||
    !matchesCall(recordCall, recordFunction) ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !returnStatement.argument
  )
    return false;
  const returned = stripParenExpression(returnStatement.argument);
  if (!isNodeOfType(returned, "ConditionalExpression") || !isSymbol(returned.test, resultSymbol))
    return false;
  const fallback = stripParenExpression(returned.consequent),
    empty = stripParenExpression(returned.alternate);
  if (
    !isNodeOfType(fallback, "LogicalExpression") ||
    fallback.operator !== "||" ||
    !isSymbol(fallback.left, errorSymbol) ||
    !isSymbol(fallback.right, resultSymbol) ||
    !isNodeOfType(empty, "Literal") ||
    empty.value !== ""
  )
    return false;
  const only = (symbol: SymbolDescriptor, values: ReadonlyArray<EsTreeNode | undefined>): boolean =>
    hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers: new Set(
        values.filter((value): value is EsTreeNode => Boolean(value)).map(stripParenExpression),
      ),
      program: module.programNode,
      scopes,
    });
  if (
    !only(callbackSymbol, [tested.argument, directCall.callee, record.init]) ||
    !only(dataSymbol, [
      directCall.arguments[OWNED_INPUT_EMPTY_COUNT],
      recordCall.arguments[OWNED_INPUT_EMPTY_COUNT],
    ]) ||
    !only(recordFunction, [recordCall.callee]) ||
    !only(errorSymbol, [fallback.left]) ||
    !only(resultSymbol, [returned.test, fallback.right])
  )
    return false;
  const calls = new Set<EsTreeNodeOfType<"CallExpression">>();
  for (const reference of binding.references) {
    if (
      isNonReferenceIdentifier(reference.identifier) ||
      reference.identifier === binding.bindingIdentifier
    )
      continue;
    const root = findTransparentExpressionRoot(reference.identifier),
      parent = root.parent;
    if (!isNodeOfType(parent, "CallExpression") || parent.optional || parent.callee !== root)
      return false;
    const [callbackValue, data, ...extra] = parent.arguments;
    if (!callbackValue || !data || extra.length) return false;
    const provided = stripParenExpression(callbackValue);
    if (
      (!isNodeOfType(provided, "Identifier") && !isNodeOfType(provided, "MemberExpression")) ||
      input.isNativeValue(provided) ||
      input.isKnownCallableReceiver(provided)
    )
      return false;
    let receiver: EsTreeNode = provided;
    while (isNodeOfType(receiver, "MemberExpression")) {
      if (
        OBJECT_PROTOTYPE_PROPERTY_NAMES.has(getStaticPropertyName(receiver) ?? "") ||
        input.isNativeValue(receiver.object) ||
        input.isKnownCallableReceiver(receiver.object)
      )
        return false;
      receiver = stripParenExpression(receiver.object);
    }
    calls.add(parent);
  }
  if (!calls.has(call)) return false;
  const [, rawData] = call.arguments;
  const dataIdentifier = rawData ? stripParenExpression(rawData) : null;
  const dataBinding = isNodeOfType(dataIdentifier, "Identifier")
    ? scopes.symbolFor(dataIdentifier)
    : null;
  const dataInitial = dataBinding ? getDirectConstInitializer(dataBinding) : null;
  const dataRecord = dataInitial ? stripParenExpression(dataInitial) : null;
  const owner = findEnclosingFunction(call);
  if (
    !dataBinding ||
    !readonly(dataBinding) ||
    !owner ||
    findEnclosingFunction(dataBinding.bindingIdentifier) !== owner ||
    !isNodeOfType(dataRecord, "ObjectExpression")
  )
    return false;
  const [spread, override, ...extraProperties] = dataRecord.properties;
  if (
    !isNodeOfType(spread, "SpreadElement") ||
    !isNodeOfType(override, "Property") ||
    override.kind !== "init" ||
    override.method ||
    extraProperties.length
  )
    return false;
  const overrideName = getStaticPropertyKeyName(override, { allowComputedString: true });
  if (
    !overrideName ||
    OBJECT_PROTOTYPE_PROPERTY_NAMES.has(overrideName) ||
    OWNED_INPUT_RESERVED_ATTRIBUTES.has(overrideName) ||
    isEventHandlerName(overrideName)
  )
    return false;
  const dataRoots = new Set<SymbolDescriptor>();
  const dataExpression = (raw: EsTreeNode, seen = new Set<SymbolDescriptor>()): boolean => {
    const node = stripParenExpression(raw);
    if (input.isNativeValue(node) || input.isKnownCallableReceiver(node)) return false;
    if (isNodeOfType(node, "Literal")) return !("regex" in node);
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (!symbol || seen.has(symbol) || !readonly(symbol) || symbol.kind === "import")
        return false;
      dataRoots.add(symbol);
      const next = new Set(seen).add(symbol);
      if (symbol.kind === "parameter")
        return (
          isFunctionLike(owner) &&
          owner.params.some((parameter) => parameter === symbol.bindingIdentifier)
        );
      const initial = getDirectConstInitializer(symbol);
      if (initial) return dataExpression(initial, next);
      const declaration = symbol.declarationNode;
      if (
        !isNodeOfType(declaration, "VariableDeclarator") ||
        !isNodeOfType(declaration.id, "ObjectPattern") ||
        !declaration.init
      )
        return false;
      const property = declaration.id.properties.find(
        (property) =>
          isNodeOfType(property, "Property") && property.value === symbol.bindingIdentifier,
      );
      const name = property
        ? getStaticPropertyKeyName(property, { allowComputedString: true })
        : null;
      return Boolean(
        name &&
        !OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) &&
        dataExpression(declaration.init, next),
      );
    }
    if (!isNodeOfType(node, "MemberExpression") || node.optional) return false;
    const name = getStaticPropertyName(node);
    if (
      name &&
      (OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) ||
        ["current", "target", "currentTarget"].includes(name))
    )
      return false;
    const receiver = stripParenExpression(node.object);
    if (isNodeOfType(receiver, "ThisExpression")) {
      const classNode = findEnclosingClass(node);
      return Boolean(
        (name === "props" || name === "state") &&
        classNode &&
        isProvenReactClassComponent(classNode, scopes),
      );
    }
    return (
      dataExpression(receiver, new Set(seen)) &&
      (!node.computed || dataExpression(node.property, new Set(seen)))
    );
  };
  if (!dataExpression(spread.argument) || !dataExpression(override.value)) return false;
  for (const source of dataRoots)
    for (const reference of source.references) {
      if (
        isNonReferenceIdentifier(reference.identifier) ||
        reference.identifier === source.bindingIdentifier
      )
        continue;
      const root = findTransparentExpressionRoot(reference.identifier);
      let current = root;
      while (
        isNodeOfType(current.parent, "MemberExpression") &&
        current.parent.object === current
      ) {
        const member = current.parent,
          name = getStaticPropertyName(member);
        if (isMemberMutationTarget(member) || (name && OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)))
          return false;
        current = findTransparentExpressionRoot(member);
      }
      const parent = current.parent;
      if (
        (isNodeOfType(parent, "CallExpression") && parent.callee === current) ||
        isNodeOfType(parent, "NewExpression") ||
        isNodeOfType(parent, "TaggedTemplateExpression")
      )
        return false;
      if (
        current === root &&
        parent !== spread &&
        !(
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "ObjectPattern")
        ) &&
        !(isNodeOfType(parent, "MemberExpression") && parent.computed && parent.property === root)
      )
        return false;
    }
  for (const reference of dataBinding.references) {
    if (
      isNonReferenceIdentifier(reference.identifier) ||
      reference.identifier === dataBinding.bindingIdentifier
    )
      continue;
    const root = findTransparentExpressionRoot(reference.identifier),
      parent = root.parent;
    if (
      !isNodeOfType(parent, "CallExpression") ||
      !calls.has(parent) ||
      parent.arguments[OWNED_INPUT_SINGLE_COUNT] !== root
    )
      return false;
  }
  if (
    [...calls].some(
      (candidate) => !isSymbol(candidate.arguments[OWNED_INPUT_SINGLE_COUNT], dataBinding),
    )
  )
    return false;
  const hasStableOwnClassDataBoundary = (classNode: EsTreeNode): boolean => {
    let stable = true;
    walkAst(classNode, (node) => {
      if (findEnclosingClass(node) !== classNode) return;
      if (isNodeOfType(node, "ThisExpression")) {
        const root = findTransparentExpressionRoot(node),
          parent = root.parent;
        if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root) stable = false;
      }
      if (
        (isNodeOfType(node, "PropertyDefinition") || isNodeOfType(node, "MethodDefinition")) &&
        getStaticPropertyKeyName(node) === "setState"
      )
        stable = false;
      if (
        !isNodeOfType(node, "MemberExpression") ||
        !isNodeOfType(stripParenExpression(node.object), "ThisExpression")
      )
        return;
      const name = getStaticPropertyName(node),
        root = findTransparentExpressionRoot(node),
        parent = root.parent;
      if (node.computed && name === null && isMemberMutationTarget(node)) stable = false;
      if (
        name === "setState" &&
        (!isNodeOfType(parent, "CallExpression") || parent.callee !== root || parent.optional)
      )
        stable = false;
    });
    return stable;
  };
  const hasConstructorEmptyStateField = (symbol: SymbolDescriptor): boolean => {
    const declaration = symbol.declarationNode,
      classNode = findEnclosingClass(declaration);
    if (
      symbol.kind !== "const" ||
      !classNode ||
      !isProvenReactClassComponent(classNode, scopes) ||
      !hasStableOwnClassDataBoundary(classNode) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "ObjectPattern") ||
      !declaration.init
    )
      return false;
    const source = stripParenExpression(declaration.init);
    if (
      !isNodeOfType(source, "MemberExpression") ||
      source.optional ||
      getStaticPropertyName(source) !== "state" ||
      !isNodeOfType(stripParenExpression(source.object), "ThisExpression")
    )
      return false;
    const selected = declaration.id.properties.find(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.method &&
        property.value === symbol.bindingIdentifier,
    );
    const field = selected
      ? getStaticPropertyKeyName(selected, { allowComputedString: true })
      : null;
    if (!field || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(field)) return false;
    const assignments: EsTreeNodeOfType<"AssignmentExpression">[] = [];
    let closed = true;
    walkAst(classNode, (node) => {
      if (findEnclosingClass(node) !== classNode) return;
      if (
        (isNodeOfType(node, "PropertyDefinition") || isNodeOfType(node, "MethodDefinition")) &&
        getStaticPropertyKeyName(node) === "state"
      )
        closed = false;
      if (
        !isNodeOfType(node, "MemberExpression") ||
        getStaticThisOrAliasFieldName(node, new Set(), classNode) !== "state"
      )
        return;
      const root = findTransparentExpressionRoot(node),
        parent = root.parent;
      if (
        isNodeOfType(parent, "AssignmentExpression") &&
        parent.left === root &&
        parent.operator === "="
      ) {
        const functionOwner = findEnclosingFunction(parent),
          method = functionOwner?.parent;
        if (
          !isNodeOfType(method, "MethodDefinition") ||
          method.kind !== "constructor" ||
          !isNodeOfType(functionOwner, "FunctionExpression") ||
          !isNodeOfType(parent.parent, "ExpressionStatement") ||
          parent.parent.parent !== functionOwner.body
        )
          closed = false;
        assignments.push(parent);
        return;
      }
      if (
        isMemberMutationTarget(node) ||
        !(
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "ObjectPattern")
        )
      )
        closed = false;
    });
    const [assignment, ...extraAssignments] = assignments;
    if (!closed || !assignment || extraAssignments.length) return false;
    const initial = stripParenExpression(assignment.right);
    if (!isNodeOfType(initial, "ObjectExpression")) return false;
    const names = new Set<string>();
    let hasEmptyField = false;
    for (const property of initial.properties) {
      if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
        return false;
      const name = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (!name || names.has(name) || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)) return false;
      names.add(name);
      if (name === field) {
        const value = stripParenExpression(property.value);
        hasEmptyField = isNodeOfType(value, "ObjectExpression") && !value.properties.length;
      }
    }
    if (!hasEmptyField) return false;
    const isSameStateFieldAlias = (
      raw: EsTreeNode,
      seen = new Set<SymbolDescriptor>(),
    ): boolean => {
      const value = stripParenExpression(raw);
      if (!isNodeOfType(value, "Identifier")) return false;
      const alias = scopes.symbolFor(value);
      if (
        !alias ||
        alias.kind !== "const" ||
        seen.has(alias) ||
        !readonly(alias) ||
        findEnclosingClass(alias.bindingIdentifier) !== classNode
      )
        return false;
      seen.add(alias);
      const initializer = getDirectConstInitializer(alias);
      if (initializer) return isSameStateFieldAlias(initializer, seen);
      const binding = alias.declarationNode;
      if (
        !isNodeOfType(binding, "VariableDeclarator") ||
        !isNodeOfType(binding.id, "ObjectPattern") ||
        !binding.init
      )
        return false;
      const receiver = stripParenExpression(binding.init);
      if (
        !isNodeOfType(receiver, "MemberExpression") ||
        receiver.optional ||
        getStaticPropertyName(receiver) !== "state" ||
        !isNodeOfType(stripParenExpression(receiver.object), "ThisExpression")
      )
        return false;
      return binding.id.properties.some(
        (property) =>
          isNodeOfType(property, "Property") &&
          property.kind === "init" &&
          !property.method &&
          property.value === alias.bindingIdentifier &&
          getStaticPropertyKeyName(property, { allowComputedString: true }) === field,
      );
    };
    walkAst(classNode, (node) => {
      if (
        !closed ||
        findEnclosingClass(node) !== classNode ||
        !isNodeOfType(node, "CallExpression")
      )
        return;
      const callee = stripParenExpression(node.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        getStaticThisOrAliasFieldName(callee, new Set(), classNode) !== "setState"
      )
        return;
      const [rawUpdate] = node.arguments,
        update = rawUpdate ? stripParenExpression(rawUpdate) : null;
      if (node.optional || !isNodeOfType(update, "ObjectExpression")) {
        closed = false;
        return;
      }
      const updateNames = new Set<string>();
      for (const property of update.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.method ||
          property.computed
        ) {
          closed = false;
          return;
        }
        const name = getStaticPropertyKeyName(property);
        if (!name || updateNames.has(name) || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name)) {
          closed = false;
          return;
        }
        updateNames.add(name);
        if (name !== field) continue;
        const value = stripParenExpression(property.value);
        if (
          !(isNodeOfType(value, "ObjectExpression") && !value.properties.length) &&
          !isSameStateFieldAlias(value)
        ) {
          closed = false;
          return;
        }
      }
    });
    return closed;
  };
  const hasEmptyOwnRecordRoot = (
    symbol: SymbolDescriptor,
    seen = new Set<SymbolDescriptor>(),
  ): boolean => {
    if (seen.has(symbol) || !readonly(symbol)) return false;
    seen.add(symbol);
    const initial = getDirectConstInitializer(symbol);
    if (!initial) return hasConstructorEmptyStateField(symbol);
    const value = stripParenExpression(initial);
    if (isNodeOfType(value, "ObjectExpression")) return !value.properties.length;
    const previous = isNodeOfType(value, "Identifier") ? scopes.symbolFor(value) : null;
    return Boolean(previous && hasEmptyOwnRecordRoot(previous, seen));
  };
  const checkedSinks = new Set<SymbolDescriptor>();
  const closedDataSink = (symbol: SymbolDescriptor): boolean => {
    if (checkedSinks.has(symbol)) return true;
    if (!readonly(symbol) || !hasEmptyOwnRecordRoot(symbol)) return false;
    checkedSinks.add(symbol);
    const initializer = getDirectConstInitializer(symbol);
    if (initializer && isNodeOfType(stripParenExpression(initializer), "Identifier")) {
      const previous = scopes.symbolFor(stripParenExpression(initializer));
      if (!previous || !closedDataSink(previous)) return false;
    }
    return symbol.references.every((reference) => {
      if (
        isNonReferenceIdentifier(reference.identifier) ||
        reference.identifier === symbol.bindingIdentifier
      )
        return true;
      const root = findTransparentExpressionRoot(reference.identifier),
        parent = root.parent;
      if (isNodeOfType(parent, "MemberExpression") && parent.object === root)
        return isMemberMutationTarget(parent);
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const alias = scopes.symbolFor(parent.id);
        return Boolean(alias && closedDataSink(alias));
      }
      if (
        !isNodeOfType(parent, "Property") ||
        parent.value !== root ||
        parent.kind !== "init" ||
        parent.method
      )
        return false;
      const record = parent.parent,
        invocation = record?.parent;
      if (
        !isNodeOfType(record, "ObjectExpression") ||
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.optional ||
        invocation.arguments.length !== OWNED_INPUT_SINGLE_COUNT
      )
        return false;
      const [argument] = invocation.arguments,
        [property, ...extraProperties] = record.properties;
      const name = getStaticPropertyKeyName(parent, { allowComputedString: true });
      if (
        argument !== record ||
        property !== parent ||
        extraProperties.length ||
        parent.computed ||
        !name ||
        OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) ||
        OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) ||
        isEventHandlerName(name)
      )
        return false;
      const callee = stripParenExpression(invocation.callee),
        classNode = findEnclosingClass(invocation);
      if (
        !classNode ||
        !isProvenReactClassComponent(classNode, scopes) ||
        !isNodeOfType(callee, "MemberExpression") ||
        getStaticPropertyName(callee) !== "setState" ||
        !isNodeOfType(stripParenExpression(callee.object), "ThisExpression")
      )
        return false;
      return hasStableOwnClassDataBoundary(classNode);
    });
  };
  const checkedValues = new Set<EsTreeNode>();
  const checkedSymbols = new Set<SymbolDescriptor>();
  const checkedReturns = new Set<EsTreeNode>();
  const resultUse = (raw: EsTreeNode): boolean => {
    const value = findTransparentExpressionRoot(raw);
    if (checkedValues.has(value)) return true;
    checkedValues.add(value);
    const parent = value.parent;
    if (!parent) return false;
    if (isNodeOfType(parent, "IfStatement") && parent.test === value) return true;
    if (
      isNodeOfType(parent, "UnaryExpression") &&
      (parent.operator === "!" || parent.operator === "typeof")
    )
      return true;
    if (isNodeOfType(parent, "BinaryExpression") && ["===", "!=="].includes(parent.operator))
      return true;
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test === value) return true;
    if (isNodeOfType(parent, "LogicalExpression") || isNodeOfType(parent, "ConditionalExpression"))
      return resultUse(parent);
    if (isNodeOfType(parent, "JSXExpressionContainer")) {
      const attribute = parent.parent;
      return (
        !isNodeOfType(attribute, "JSXAttribute") ||
        (!OWNED_INPUT_RESERVED_ATTRIBUTES.has(getJsxAttributeName(attribute.name) ?? "") &&
          !isEventHandlerName(getJsxAttributeName(attribute.name) ?? ""))
      );
    }
    if (
      (isNodeOfType(parent, "ReturnStatement") && parent.argument === value) ||
      (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === value)
    ) {
      const returnOwner = isNodeOfType(parent, "ArrowFunctionExpression")
        ? parent
        : findEnclosingFunction(parent);
      if (!returnOwner || checkedReturns.has(returnOwner)) return true;
      checkedReturns.add(returnOwner);
      const ownerValue = findTransparentExpressionRoot(returnOwner),
        ownerUse = ownerValue.parent;
      if (isNodeOfType(ownerUse, "CallExpression") && ownerUse.callee === ownerValue)
        return !ownerUse.optional && resultUse(ownerUse);
      if (
        (isNodeOfType(ownerUse, "NewExpression") && ownerUse.callee === ownerValue) ||
        (isNodeOfType(ownerUse, "TaggedTemplateExpression") && ownerUse.tag === ownerValue)
      )
        return false;
      for (const symbol of getFunctionBindingSymbols(returnOwner, scopes))
        for (const reference of symbol.references) {
          if (isNonReferenceIdentifier(reference.identifier)) continue;
          const root = findTransparentExpressionRoot(reference.identifier),
            invocation = root.parent;
          if (
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.callee !== root ||
            !resultUse(invocation)
          )
            return false;
        }
      const definition = findTransparentExpressionRoot(returnOwner).parent;
      const classNode = findEnclosingClass(returnOwner);
      const name =
        isNodeOfType(definition, "PropertyDefinition") ||
        isNodeOfType(definition, "MethodDefinition")
          ? getStaticPropertyKeyName(definition)
          : null;
      if (name && classNode) {
        let closed = true;
        walkAst(classNode, (node) => {
          if (!closed) return false;
          if (
            !isNodeOfType(node, "MemberExpression") ||
            getStaticThisOrAliasFieldName(node, new Set(), classNode) !== name
          )
            return;
          const root = findTransparentExpressionRoot(node),
            invocation = root.parent;
          if (
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.callee !== root ||
            !resultUse(invocation)
          )
            closed = false;
        });
        if (!closed) return false;
      }
      return true;
    }
    const target =
      isNodeOfType(parent, "VariableDeclarator") && parent.init === value
        ? parent.id
        : isNodeOfType(parent, "AssignmentExpression") &&
            parent.right === value &&
            parent.operator === "="
          ? parent.left
          : null;
    if (isNodeOfType(target, "Identifier")) {
      const symbol = scopes.symbolFor(target);
      if (!symbol || !hasCompleteSymbolReferences(symbol, module.programNode, scopes)) return false;
      if (checkedSymbols.has(symbol)) return true;
      checkedSymbols.add(symbol);
      return symbol.references.every((reference) => {
        if (
          isNonReferenceIdentifier(reference.identifier) ||
          reference.identifier === symbol.bindingIdentifier
        )
          return true;
        const root = findTransparentExpressionRoot(reference.identifier),
          use = root.parent;
        if (reference.flag !== "read") {
          const assigned = isNodeOfType(use, "AssignmentExpression")
            ? stripParenExpression(use.right)
            : null;
          return (
            isNodeOfType(use, "AssignmentExpression") &&
            use.left === root &&
            use.operator === "=" &&
            isNodeOfType(assigned, "CallExpression") &&
            calls.has(assigned)
          );
        }
        return resultUse(reference.identifier);
      });
    }
    if (isNodeOfType(target, "MemberExpression")) {
      if (input.isNativeValue(target.object) || input.isKnownCallableReceiver(target.object))
        return false;
      const name = getStaticPropertyName(target);
      if (
        name &&
        (OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) || OWNED_INPUT_RESERVED_ATTRIBUTES.has(name))
      )
        return false;
      const receiver = stripParenExpression(target.object),
        symbol = isNodeOfType(receiver, "Identifier") ? scopes.symbolFor(receiver) : null;
      return Boolean(symbol && closedDataSink(symbol));
    }
    return false;
  };
  return [...calls].every(resultUse);
};
