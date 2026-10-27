import { REACT_JSX_PROVIDER_MODULE_SOURCES } from "../constants/react.js";
import * as path from "node:path";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import {
  IMPORTED_TIMER_CONSTRUCTOR_ARGUMENT_COUNT,
  IMPORTED_TIMER_ROLE_METHOD_COUNT,
  NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES,
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findExportedValue } from "./find-exported-value.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getClassBindingSymbol } from "./get-class-binding-symbol.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getEffectCallback } from "./get-effect-callback.js";
import { getImportedName } from "./get-imported-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isEventHandlerAttribute } from "./is-event-handler-attribute.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import {
  hasStandardReactJsxConfiguration,
  resolveTsconfigAliasPath,
} from "./resolve-tsconfig-alias.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkInsideStatementBlocks } from "./walk-inside-statement-blocks.js";

interface ImportedTimerClassSummary {
  readonly module: SourceProjectModule;
  readonly node: EsTreeNodeOfType<"ClassDeclaration">;
  readonly exportedName: string;
  readonly scheduleName: string;
  readonly cancelName: string;
  readonly callbackField: string;
  readonly delayField: string;
  readonly handleField: string;
}

interface ImportedTimerStateCarrier {
  readonly state: SymbolDescriptor;
  readonly component: EsTreeNode;
  readonly storage: EsTreeNodeOfType<"CallExpression">;
}

interface ImportedTimerClassLifetime {
  readonly shape: ImportedTimerClassSummary;
  readonly module: SourceProjectModule;
  readonly callback: EsTreeNode;
  readonly local: SymbolDescriptor;
  readonly carrier: ImportedTimerStateCarrier;
}

const hasImportedTimerReactSourceConfiguration = (filename: string): boolean =>
  hasStandardReactJsxConfiguration(filename) &&
  [...REACT_JSX_PROVIDER_MODULE_SOURCES].every(
    (source) =>
      resolveTsconfigAliasPath(filename, source) === null &&
      resolveWebpackAliasPath(filename, source)?.declared !== true,
  );

const getImportedTimerClassSummary = (
  node: EsTreeNode,
  module: SourceProjectModule,
  exportedName: string,
): ImportedTimerClassSummary | null => {
  if (
    !isNodeOfType(node, "ClassDeclaration") ||
    !node.id ||
    node.superClass ||
    node.decorators?.length ||
    ("abstract" in node && node.abstract) ||
    ("declare" in node && node.declare)
  )
    return null;
  const fields = new Set<string>();
  const methods = new Map<string, EsTreeNodeOfType<"FunctionExpression">>();
  let constructor: EsTreeNodeOfType<"FunctionExpression"> | null = null;
  for (const member of node.body.body) {
    if (
      (!isNodeOfType(member, "PropertyDefinition") && !isNodeOfType(member, "MethodDefinition")) ||
      member.static ||
      member.computed ||
      member.decorators?.length
    )
      return null;
    const name = getStaticPropertyKeyName(member);
    if (!name || name === "__proto__" || fields.has(name) || methods.has(name)) return null;
    if (isNodeOfType(member, "PropertyDefinition")) {
      if (member.value) return null;
      fields.add(name);
      continue;
    }
    if (
      !isNodeOfType(member.value, "FunctionExpression") ||
      member.value.async ||
      member.value.generator ||
      !isNodeOfType(member.value.body, "BlockStatement")
    )
      return null;
    if (member.kind === "constructor") {
      if (constructor) return null;
      constructor = member.value;
    } else {
      if (member.kind !== "method" || member.value.params.length) return null;
      methods.set(name, member.value);
    }
  }
  if (
    !constructor ||
    constructor.params.length !== IMPORTED_TIMER_CONSTRUCTOR_ARGUMENT_COUNT ||
    constructor.body.body.length !== IMPORTED_TIMER_CONSTRUCTOR_ARGUMENT_COUNT ||
    methods.size !== IMPORTED_TIMER_ROLE_METHOD_COUNT ||
    !constructor.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  )
    return null;
  const [delayParameter, callbackParameter] = constructor.params;
  const initialFields = new Map<SymbolDescriptor, string>();
  for (const statement of constructor.body.body) {
    const assignment = isNodeOfType(statement, "ExpressionStatement")
      ? stripParenExpression(statement.expression)
      : null;
    const receiver = isNodeOfType(assignment, "AssignmentExpression")
      ? stripParenExpression(assignment.left)
      : null;
    const value = isNodeOfType(assignment, "AssignmentExpression")
      ? stripParenExpression(assignment.right)
      : null;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      !isNodeOfType(receiver, "MemberExpression") ||
      receiver.computed ||
      receiver.optional ||
      !isNodeOfType(receiver.object, "ThisExpression") ||
      !isNodeOfType(value, "Identifier")
    )
      return null;
    const name = getStaticPropertyName(receiver);
    const parameter = module.scopes.symbolFor(value);
    if (
      !name ||
      !fields.has(name) ||
      !parameter ||
      initialFields.has(parameter) ||
      !constructor.params.some((candidate) => module.scopes.symbolFor(candidate) === parameter)
    )
      return null;
    initialFields.set(parameter, name);
  }
  const delaySymbol = module.scopes.symbolFor(delayParameter);
  const callbackSymbol = module.scopes.symbolFor(callbackParameter);
  const delayField = delaySymbol ? initialFields.get(delaySymbol) : null;
  const callbackField = callbackSymbol ? initialFields.get(callbackSymbol) : null;
  if (!delayField || !callbackField || delayField === callbackField) return null;
  let scheduleName: string | null = null;
  let handleField: string | null = null;
  const clearFields = new Map<string, string>();
  const clearStatements = new Map<string, EsTreeNode>();
  let dateWriteField: string | null = null;
  let dateReadField: string | null = null;
  let dateWriteMethod: string | null = null;
  let dateReadMethod: string | null = null;
  for (const [name, method] of methods) {
    if (!isNodeOfType(method.body, "BlockStatement")) return null;
    for (const statement of method.body.body) {
      if (!isNodeOfType(statement, "ExpressionStatement")) return null;
      const expression = stripParenExpression(statement.expression);
      if (isNodeOfType(expression, "CallExpression")) {
        const callee = stripParenExpression(expression.callee);
        const [argument, ...extra] = expression.arguments;
        const slot = argument ? stripParenExpression(argument) : null;
        if (
          expression.optional ||
          !isNodeOfType(callee, "Identifier") ||
          callee.name !== "clearTimeout" ||
          !module.scopes.isGlobalReference(callee) ||
          extra.length ||
          !isNodeOfType(slot, "MemberExpression") ||
          slot.computed ||
          slot.optional ||
          !isNodeOfType(slot.object, "ThisExpression")
        )
          return null;
        const field = getStaticPropertyName(slot);
        if (!field || !fields.has(field) || clearFields.has(name)) return null;
        clearFields.set(name, field);
        clearStatements.set(name, statement);
        continue;
      }
      if (!isNodeOfType(expression, "AssignmentExpression")) return null;
      const receiver = stripParenExpression(expression.left);
      const value = stripParenExpression(expression.right);
      if (
        !isNodeOfType(receiver, "MemberExpression") ||
        receiver.computed ||
        receiver.optional ||
        !isNodeOfType(receiver.object, "ThisExpression")
      )
        return null;
      const field = getStaticPropertyName(receiver);
      if (!field || !fields.has(field)) return null;
      if (expression.operator === "=" && isNodeOfType(value, "CallExpression")) {
        const callee = stripParenExpression(value.callee);
        const [callbackArgument, delayArgument, ...extra] = value.arguments;
        const callback = callbackArgument ? stripParenExpression(callbackArgument) : null;
        const delay = delayArgument ? stripParenExpression(delayArgument) : null;
        if (
          method.body.body.at(-1) !== statement ||
          scheduleName ||
          value.optional ||
          !isNodeOfType(callee, "Identifier") ||
          callee.name !== "setTimeout" ||
          !module.scopes.isGlobalReference(callee) ||
          extra.length ||
          !isNodeOfType(callback, "MemberExpression") ||
          callback.computed ||
          callback.optional ||
          !isNodeOfType(callback.object, "ThisExpression") ||
          getStaticPropertyName(callback) !== callbackField ||
          !isNodeOfType(delay, "MemberExpression") ||
          delay.computed ||
          delay.optional ||
          !isNodeOfType(delay.object, "ThisExpression") ||
          getStaticPropertyName(delay) !== delayField
        )
          return null;
        scheduleName = name;
        handleField = field;
        continue;
      }
      if (
        expression.operator === "=" &&
        isNodeOfType(value, "NewExpression") &&
        isNodeOfType(value.callee, "Identifier") &&
        value.callee.name === "Date" &&
        module.scopes.isGlobalReference(value.callee) &&
        !value.arguments.length
      ) {
        if (dateWriteField || field === callbackField || field === delayField) return null;
        dateWriteField = field;
        dateWriteMethod = name;
        continue;
      }
      if (
        expression.operator !== "-=" ||
        field !== delayField ||
        !isNodeOfType(value, "BinaryExpression") ||
        value.operator !== "-"
      )
        return null;
      const current = stripParenExpression(value.left);
      const previous = stripParenExpression(value.right);
      const currentMember = isNodeOfType(current, "CallExpression")
        ? stripParenExpression(current.callee)
        : null;
      const previousMember = isNodeOfType(previous, "CallExpression")
        ? stripParenExpression(previous.callee)
        : null;
      const currentDate = isNodeOfType(currentMember, "MemberExpression")
        ? stripParenExpression(currentMember.object)
        : null;
      const previousDate = isNodeOfType(previousMember, "MemberExpression")
        ? stripParenExpression(previousMember.object)
        : null;
      if (
        dateReadField ||
        !isNodeOfType(current, "CallExpression") ||
        current.optional ||
        current.arguments.length ||
        !isNodeOfType(previous, "CallExpression") ||
        previous.optional ||
        previous.arguments.length ||
        !isNodeOfType(currentMember, "MemberExpression") ||
        currentMember.computed ||
        currentMember.optional ||
        getStaticPropertyName(currentMember) !== "getTime" ||
        !isNodeOfType(previousMember, "MemberExpression") ||
        previousMember.computed ||
        previousMember.optional ||
        getStaticPropertyName(previousMember) !== "getTime" ||
        !isNodeOfType(currentDate, "NewExpression") ||
        currentDate.arguments.length ||
        !isNodeOfType(currentDate.callee, "Identifier") ||
        currentDate.callee.name !== "Date" ||
        !module.scopes.isGlobalReference(currentDate.callee) ||
        !isNodeOfType(previousDate, "MemberExpression") ||
        previousDate.computed ||
        previousDate.optional ||
        !isNodeOfType(previousDate.object, "ThisExpression")
      )
        return null;
      dateReadMethod = name;
      dateReadField = getStaticPropertyName(previousDate);
      if (!dateReadField) return null;
    }
  }
  if (
    !scheduleName ||
    !handleField ||
    callbackField === handleField ||
    delayField === handleField ||
    dateWriteField !== dateReadField ||
    (dateWriteField && dateWriteField === handleField)
  )
    return null;
  const cancellation = [...methods.keys()].find((name) => name !== scheduleName);
  const cancellationMethod = cancellation ? methods.get(cancellation) : null;
  const [firstCancellationStatement] =
    cancellationMethod && isNodeOfType(cancellationMethod.body, "BlockStatement")
      ? cancellationMethod.body.body
      : [];
  if (
    !cancellation ||
    !cancellationMethod ||
    !isNodeOfType(cancellationMethod.body, "BlockStatement") ||
    firstCancellationStatement !== clearStatements.get(cancellation) ||
    (dateWriteMethod && dateWriteMethod !== scheduleName) ||
    (dateReadMethod && dateReadMethod !== cancellation) ||
    clearFields.get(cancellation) !== handleField ||
    (clearFields.has(scheduleName) && clearFields.get(scheduleName) !== handleField)
  )
    return null;
  return {
    module,
    node,
    exportedName,
    scheduleName,
    cancelName: cancellation,
    callbackField,
    delayField,
    handleField,
  };
};

const getImportedTimerStateCarrier = (
  creation: EsTreeNodeOfType<"NewExpression">,
  local: SymbolDescriptor,
  callback: EsTreeNode,
  module: SourceProjectModule,
  shape: ImportedTimerClassSummary,
): ImportedTimerStateCarrier | null => {
  const declaration = findTransparentExpressionRoot(creation).parent;
  const statement = declaration?.parent;
  const block = statement?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== local.bindingIdentifier ||
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    !isNodeOfType(block, "BlockStatement")
  )
    return null;
  const [allocationStatement, scheduleStatement, storageStatement, ...extra] = block.body.filter(
    (statement) => !isNodeOfType(statement, "EmptyStatement"),
  );
  const [onlyDeclaration, ...extraDeclarations] = statement.declarations;
  const schedule = isNodeOfType(scheduleStatement, "ExpressionStatement")
    ? stripParenExpression(scheduleStatement.expression)
    : null;
  const storage = isNodeOfType(storageStatement, "ExpressionStatement")
    ? stripParenExpression(storageStatement.expression)
    : null;
  const member = isNodeOfType(schedule, "CallExpression")
    ? stripParenExpression(schedule.callee)
    : null;
  const receiver = isNodeOfType(member, "MemberExpression")
    ? stripParenExpression(member.object)
    : null;
  if (
    extra.length ||
    allocationStatement !== statement ||
    onlyDeclaration !== declaration ||
    extraDeclarations.length ||
    !isNodeOfType(schedule, "CallExpression") ||
    schedule.optional ||
    schedule.arguments.length ||
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(receiver, "Identifier") ||
    module.scopes.symbolFor(receiver) !== local ||
    getStaticPropertyName(member) !== shape.scheduleName ||
    !isNodeOfType(storage, "CallExpression") ||
    storage.optional ||
    !isNodeOfType(storage.callee, "Identifier")
  )
    return null;
  const [stored, ...storageExtra] = storage.arguments;
  if (
    !isNodeOfType(stored, "Identifier") ||
    module.scopes.symbolFor(stored) !== local ||
    storageExtra.length
  )
    return null;
  const pair = resolveReactUseStatePair(storage.callee, module.scopes);
  const initial = pair?.declarator.init;
  const component = findEnclosingFunction(callback);
  if (
    !pair?.stateSymbol ||
    !isNodeOfType(initial, "CallExpression") ||
    !isProvenUnmodifiedReactApiCall(initial, "useState", module.scopes) ||
    !component ||
    findEnclosingFunction(pair.declarator) !== component ||
    findEnclosingFunction(creation) !== callback
  )
    return null;
  const [initialValue, ...initialExtra] = initial.arguments;
  if (
    !isNodeOfType(initialValue, "Literal") ||
    initialValue.value !== null ||
    initialExtra.length ||
    hasSymbolBindingWrites(pair.stateSymbol) ||
    hasSymbolBindingWrites(pair.setterSymbol)
  )
    return null;
  const allowedSetters = new Set<EsTreeNode>();
  for (const reference of pair.setterSymbol.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const call = identifier.parent;
    if (isNonReferenceIdentifier(reference.identifier)) continue;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== identifier ||
      findEnclosingFunction(call) !== callback
    )
      return null;
    const [value, ...argumentsAfterValue] = call.arguments;
    const expression = value ? stripParenExpression(value) : null;
    if (
      argumentsAfterValue.length ||
      !(
        (isNodeOfType(expression, "Literal") && expression.value === null) ||
        (call === storage &&
          isNodeOfType(expression, "Identifier") &&
          module.scopes.symbolFor(expression) === local)
      )
    )
      return null;
    allowedSetters.add(reference.identifier);
  }
  if (
    !hasOnlyAllowedSymbolReads({
      symbol: pair.setterSymbol,
      scopes: module.scopes,
      program: module.programNode,
      allowedIdentifiers: allowedSetters,
    })
  )
    return null;
  return { state: pair.stateSymbol, component, storage };
};

const hasOtherEffectTimerCleanupRead = (lifetime: ImportedTimerClassLifetime): boolean => {
  let found = false;
  const { module, callback, carrier } = lifetime;
  walkAst(carrier.component, (node) => {
    if (found) return false;
    if (
      !isNodeOfType(node, "CallExpression") ||
      findEnclosingFunction(node) !== carrier.component ||
      !(
        isProvenUnmodifiedReactApiCall(node, "useEffect", module.scopes) ||
        isProvenUnmodifiedReactApiCall(node, "useLayoutEffect", module.scopes)
      )
    )
      return;
    const owner = getEffectCallback(node, module.scopes);
    if (!owner || owner === callback || !isFunctionLike(owner)) return;
    const returned: EsTreeNode[] = [];
    if (isNodeOfType(owner.body, "BlockStatement")) {
      walkInsideStatementBlocks(owner.body, (child) => {
        if (isNodeOfType(child, "ReturnStatement") && child.argument) returned.push(child.argument);
      });
    } else returned.push(owner.body);
    for (const expression of returned) {
      const cleanup = resolveExactLocalFunction(expression, module.scopes) ?? expression;
      if (
        carrier.state.references.some((reference) => isAstDescendant(reference.identifier, cleanup))
      )
        found = true;
    }
  });
  return found;
};

const hasClosedTimerInstanceReads = (lifetime: ImportedTimerClassLifetime): boolean => {
  const { module, callback, local, carrier, shape } = lifetime;
  if (hasSymbolBindingWrites(local) || hasOtherEffectTimerCleanupRead(lifetime)) return false;
  for (const symbol of [local, carrier.state]) {
    const allowed = new Set<EsTreeNode>();
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      if (isNonReferenceIdentifier(identifier) || isTypeScriptTypePosition(identifier)) {
        allowed.add(identifier);
        continue;
      }
      const root = findTransparentExpressionRoot(identifier);
      const parent = root.parent;
      if (symbol === local && parent === carrier.storage) {
        allowed.add(identifier);
        continue;
      }
      if (
        symbol === carrier.state &&
        ((isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
          (isNodeOfType(parent, "IfStatement") && parent.test === root) ||
          (isNodeOfType(parent, "ConditionalExpression") && parent.test === root) ||
          (isNodeOfType(parent, "LogicalExpression") &&
            parent.left === root &&
            parent.operator === "&&") ||
          (isNodeOfType(parent, "BinaryExpression") &&
            ["===", "!==", "==", "!="].includes(parent.operator)))
      ) {
        allowed.add(identifier);
        continue;
      }
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== root ||
        parent.computed ||
        parent.optional ||
        isMemberMutationTarget(parent)
      )
        return false;
      const name = getStaticPropertyName(parent);
      const callRoot = findTransparentExpressionRoot(parent);
      const call = callRoot.parent;
      if (
        (name !== shape.scheduleName && name !== shape.cancelName) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== callRoot ||
        call.optional ||
        call.arguments.length
      )
        return false;
      const owner = findEnclosingFunction(call);
      if (owner === callback) {
        allowed.add(identifier);
        continue;
      }
      if (
        symbol !== carrier.state ||
        !isNodeOfType(owner, "ArrowFunctionExpression") ||
        owner.async ||
        owner.params.length ||
        findEnclosingFunction(owner) !== carrier.component
      )
        return false;
      const body = stripParenExpression(owner.body);
      const returned = getSingleReturnExpression(owner);
      const [onlyStatement, ...extra] = isNodeOfType(body, "BlockStatement") ? body.body : [];
      if (
        body !== call &&
        !(returned && stripParenExpression(returned) === call) &&
        !(
          isNodeOfType(onlyStatement, "ExpressionStatement") &&
          stripParenExpression(onlyStatement.expression) === call &&
          !extra.length
        )
      )
        return false;
      let publication = findTransparentExpressionRoot(owner).parent;
      while (
        isNodeOfType(publication, "ConditionalExpression") ||
        isNodeOfType(publication, "LogicalExpression")
      )
        publication = publication.parent;
      if (
        !isNodeOfType(publication, "JSXExpressionContainer") ||
        !isEventHandlerAttribute(publication.parent)
      )
        return false;
      allowed.add(identifier);
    }
    if (
      !hasOnlyAllowedSymbolReads({
        symbol,
        scopes: module.scopes,
        program: module.programNode,
        allowedIdentifiers: allowed,
      })
    )
      return false;
  }
  return true;
};

const hasClosedImportedTimerProviders = (
  index: SourceProjectIndex,
  lifetime: ImportedTimerClassLifetime,
): boolean => {
  const { shape, local, carrier } = lifetime;
  const protectedNames = new Set([
    "setTimeout",
    "clearTimeout",
    "Date",
    "getTime",
    shape.handleField,
    shape.callbackField,
    shape.delayField,
    shape.scheduleName,
    shape.cancelName,
  ]);
  for (const module of index.modulesByFilePath.values()) {
    if (
      hasReactDefaultProviderMutation("useEffect", module.scopes) ||
      hasReactDefaultProviderMutation("useLayoutEffect", module.scopes) ||
      hasReactDefaultProviderMutation("useState", module.scopes)
    )
      return false;
    const constructors = new Set<SymbolDescriptor>();
    if (module === shape.module) {
      const symbol = getClassBindingSymbol(shape.node, module.scopes);
      if (!symbol) return false;
      constructors.add(symbol);
    }
    const readonlyReactMocks = new Set<EsTreeNode>();
    const readonlyReactActualCalls = new Set<EsTreeNode>();
    walkAst(module.programNode, (node) => {
      if (!isNodeOfType(node, "CallExpression") || node.optional) return;
      const callee = stripParenExpression(node.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        callee.optional ||
        callee.computed ||
        getStaticPropertyName(callee) !== "mock"
      )
        return;
      const receiver = stripParenExpression(callee.object);
      if (
        !isNodeOfType(receiver, "Identifier") ||
        !["jest", "vi"].includes(receiver.name) ||
        !module.scopes.isGlobalReference(receiver)
      )
        return;
      const [dependency, factory, ...extraArguments] = node.arguments;
      if (
        !isNodeOfType(dependency, "Literal") ||
        dependency.value !== "react" ||
        extraArguments.length ||
        !factory ||
        !isFunctionLike(factory) ||
        factory.async ||
        factory.generator ||
        factory.params.length ||
        !isNodeOfType(factory.body, "BlockStatement")
      )
        return;
      const [declaration, returned, ...extraStatements] = factory.body.body;
      if (
        extraStatements.length ||
        !isNodeOfType(declaration, "VariableDeclaration") ||
        declaration.kind !== "const" ||
        !isNodeOfType(returned, "ReturnStatement") ||
        !returned.argument
      )
        return;
      const [binding, ...extraBindings] = declaration.declarations;
      if (
        !binding ||
        extraBindings.length ||
        !isNodeOfType(binding.id, "Identifier") ||
        !binding.init
      )
        return;
      const actualCall = stripParenExpression(binding.init);
      if (!isNodeOfType(actualCall, "CallExpression") || actualCall.optional) return;
      const actualCallee = stripParenExpression(actualCall.callee);
      if (
        !isNodeOfType(actualCallee, "MemberExpression") ||
        actualCallee.optional ||
        actualCallee.computed ||
        getStaticPropertyName(actualCallee) !== "requireActual"
      )
        return;
      const actualReceiver = stripParenExpression(actualCallee.object);
      const [actualDependency, ...extraActualArguments] = actualCall.arguments;
      if (
        !isNodeOfType(actualReceiver, "Identifier") ||
        actualReceiver.name !== receiver.name ||
        !module.scopes.isGlobalReference(actualReceiver) ||
        extraActualArguments.length ||
        !isNodeOfType(actualDependency, "Literal") ||
        actualDependency.value !== "react"
      )
        return;
      const result = stripParenExpression(returned.argument);
      if (!isNodeOfType(result, "ObjectExpression")) return;
      const [spread, override, ...extraProperties] = result.properties;
      if (
        extraProperties.length ||
        !isNodeOfType(spread, "SpreadElement") ||
        !isNodeOfType(override, "Property") ||
        override.computed ||
        override.method ||
        override.kind !== "init" ||
        getStaticPropertyKeyName(override) !== "useReducer"
      )
        return;
      const borrowed = stripParenExpression(spread.argument);
      const symbol = module.scopes.symbolFor(binding.id);
      if (
        !symbol ||
        !isNodeOfType(borrowed, "Identifier") ||
        module.scopes.symbolFor(borrowed) !== symbol ||
        !hasOnlyAllowedSymbolReads({
          symbol,
          scopes: module.scopes,
          program: module.programNode,
          allowedIdentifiers: new Set([borrowed]),
        }) ||
        ["useEffect", "useLayoutEffect", "useState", "forwardRef", "createElement"].some((name) =>
          hasPossibleStaticPropertyMutationOrEscape(
            binding.id,
            name,
            module.scopes,
            (reference) => reference === borrowed,
          ),
        )
      )
        return;
      readonlyReactMocks.add(node);
      readonlyReactActualCalls.add(actualCall);
    });
    let supported = true;
    walkAst(module.programNode, (node) => {
      if (!supported) return false;
      if (
        isNodeOfType(node, "TSEnumDeclaration") &&
        isNodeOfType(node.parent, "ExportNamedDeclaration")
      ) {
        let literalData = true;
        walkAst(node, (part) => {
          if (
            !["TSEnumDeclaration", "TSEnumBody", "TSEnumMember", "Identifier", "Literal"].includes(
              part.type,
            )
          )
            literalData = false;
        });
        if (literalData) return false;
      }
      if (
        [
          "TSParameterProperty",
          "TSEnumDeclaration",
          "TSModuleDeclaration",
          "TSImportEqualsDeclaration",
        ].includes(node.type)
      ) {
        supported = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      const dependency =
        getRuntimeStaticDependencySource(node) ??
        (isNodeOfType(node, "ImportExpression") &&
        isNodeOfType(node.source, "Literal") &&
        typeof node.source.value === "string"
          ? node.source.value
          : null);
      if (isNodeOfType(node, "ImportExpression") && !dependency) {
        supported = false;
        return false;
      }
      if (dependency && NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES.has(dependency)) {
        supported = false;
        return false;
      }
      if (index.resolvedSourcePathByNode.get(node) === shape.module.filePath) {
        if (!isNodeOfType(node, "ImportDeclaration")) {
          supported = false;
          return false;
        }
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            supported = false;
            return false;
          }
          const importedName = isNodeOfType(specifier, "ImportDefaultSpecifier")
            ? "default"
            : getImportedName(specifier);
          if (importedName !== shape.exportedName) continue;
          const symbol = module.scopes.symbolFor(specifier.local);
          if (!symbol) {
            supported = false;
            return false;
          }
          constructors.add(symbol);
        }
      }
      if (isNodeOfType(node, "CallExpression")) {
        const callee = stripParenExpression(node.callee);
        const name = isNodeOfType(callee, "MemberExpression")
          ? getResolvedStaticPropertyName(callee, module.scopes)
          : isNodeOfType(callee, "Identifier")
            ? callee.name
            : null;
        if (["requireActual", "importActual"].includes(name ?? "")) {
          const [dependency] = node.arguments;
          if (
            !isNodeOfType(dependency, "Literal") ||
            typeof dependency.value !== "string" ||
            ((REACT_JSX_PROVIDER_MODULE_SOURCES.has(dependency.value) ||
              dependency.value.startsWith("react/")) &&
              !readonlyReactActualCalls.has(node)) ||
            resolveModulePath(module.filePath, dependency.value) === shape.module.filePath ||
            resolveModulePath(module.filePath, dependency.value) === lifetime.module.filePath
          ) {
            supported = false;
            return false;
          }
        }
        if (["mock", "doMock", "setMock", "unstable_mockModule"].includes(name ?? "")) {
          const [source] = node.arguments;
          if (
            !isNodeOfType(source, "Literal") ||
            typeof source.value !== "string" ||
            ((REACT_JSX_PROVIDER_MODULE_SOURCES.has(source.value) ||
              source.value.startsWith("react/")) &&
              !readonlyReactMocks.has(node)) ||
            resolveModulePath(module.filePath, source.value) === shape.module.filePath ||
            resolveModulePath(module.filePath, source.value) === lifetime.module.filePath
          ) {
            supported = false;
            return false;
          }
        }
      }
      if (isNodeOfType(node, "MemberExpression")) {
        const name = getResolvedStaticPropertyName(node, module.scopes);
        const receiver = stripParenExpression(node.object);
        if (
          ["requireActual", "importActual"].includes(name ?? "") ||
          (["mock", "doMock", "setMock", "unstable_mockModule"].includes(name ?? "") &&
            isNodeOfType(receiver, "Identifier") &&
            ["jest", "vi"].includes(receiver.name) &&
            module.scopes.isGlobalReference(receiver))
        ) {
          const getter = findTransparentExpressionRoot(node);
          const invocation = getter.parent;
          if (
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.callee !== getter ||
            invocation.optional ||
            node.optional
          ) {
            supported = false;
            return false;
          }
        }
        if (name === "__proto__") {
          supported = false;
          return false;
        }
        if (name === "constructor") {
          const comparison = findTransparentExpressionRoot(node).parent;
          if (
            !isNodeOfType(comparison, "BinaryExpression") ||
            !["===", "!==", "==", "!="].includes(comparison.operator) ||
            ![comparison.left, comparison.right].some(
              (operand) =>
                isNodeOfType(operand, "Identifier") &&
                operand.name === "Object" &&
                module.scopes.isGlobalReference(operand),
            )
          ) {
            supported = false;
            return false;
          }
        }
      }
      if (
        isNodeOfType(node, "Identifier") &&
        !isNonReferenceIdentifier(node) &&
        (protectedNames.has(node.name) ||
          [
            "require",
            "module",
            "exports",
            "Object",
            "Reflect",
            "Function",
            "Proxy",
            "window",
            "self",
            "globalThis",
            "global",
          ].includes(node.name))
      ) {
        const symbol = module.scopes.symbolFor(node);
        if (symbol && isErasedTypeScriptBinding(symbol)) {
          supported = false;
          return false;
        }
      }
      if (
        !isNodeOfType(node, "Identifier") ||
        !module.scopes.isGlobalReference(node) ||
        isNonReferenceIdentifier(node)
      )
        return;
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (["eval", "Function", "Proxy", "Reflect"].includes(node.name)) {
        supported = false;
        return false;
      }
      if (node.name === "require") {
        const [argument, ...extra] = isNodeOfType(parent, "CallExpression") ? parent.arguments : [];
        if (
          !isNodeOfType(parent, "CallExpression") ||
          parent.callee !== root ||
          parent.optional ||
          extra.length ||
          !isNodeOfType(argument, "Literal") ||
          typeof argument.value !== "string" ||
          !argument.value ||
          argument.value.startsWith(".") ||
          argument.value.startsWith("/") ||
          argument.value.startsWith("#") ||
          argument.value.startsWith("\\") ||
          (argument.value.includes(":") && !argument.value.startsWith("node:")) ||
          NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES.has(argument.value) ||
          REACT_JSX_PROVIDER_MODULE_SOURCES.has(argument.value) ||
          argument.value.startsWith("react/") ||
          resolveWebpackAliasPath(module.filePath, argument.value)?.declared === true ||
          resolveModulePath(module.filePath, argument.value) !== null
        )
          supported = false;
        return;
      }
      if (node.name === "module" || node.name === "exports") {
        if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") return;
        if (module === shape.module) {
          supported = false;
          return;
        }
        let target: EsTreeNode = root;
        if (node.name === "module") {
          if (
            !isNodeOfType(parent, "MemberExpression") ||
            parent.object !== root ||
            parent.computed ||
            parent.optional ||
            getStaticPropertyName(parent) !== "exports"
          ) {
            supported = false;
            return;
          }
          target = findTransparentExpressionRoot(parent);
          const assignment = target.parent;
          if (
            isNodeOfType(assignment, "AssignmentExpression") &&
            assignment.left === target &&
            assignment.operator === "="
          )
            return;
        }
        const field = target.parent;
        const name = isNodeOfType(field, "MemberExpression") ? getStaticPropertyName(field) : null;
        const assignment = field ? findTransparentExpressionRoot(field).parent : null;
        if (
          !isNodeOfType(field, "MemberExpression") ||
          field.object !== target ||
          field.computed ||
          field.optional ||
          !name ||
          [
            "constructor",
            "prototype",
            "__proto__",
            "require",
            "cache",
            "main",
            "resolve",
            "load",
            "createRequire",
            "Module",
            "_load",
            "_compile",
            "_resolveFilename",
          ].includes(name) ||
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.left !== findTransparentExpressionRoot(field) ||
          assignment.operator !== "="
        )
          supported = false;
        return;
      }
      if (["setTimeout", "clearTimeout"].includes(node.name)) {
        if (!isNodeOfType(parent, "CallExpression") || parent.callee !== root || parent.optional)
          supported = false;
        return;
      }
      if (node.name === "Date") {
        if (!isNodeOfType(parent, "NewExpression") || parent.callee !== root) supported = false;
        return;
      }
      if (["window", "self", "globalThis", "global"].includes(node.name)) {
        if (isNodeOfType(parent, "MemberExpression") && parent.object === root) {
          const name = getResolvedStaticPropertyName(parent, module.scopes);
          if (
            !name ||
            protectedNames.has(name) ||
            [
              "Object",
              "Reflect",
              "eval",
              "Function",
              "Proxy",
              "window",
              "self",
              "globalThis",
              "global",
            ].includes(name)
          )
            supported = false;
          return;
        }
        if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") return;
        const receiver = isNodeOfType(parent, "CallExpression")
          ? stripParenExpression(parent.callee)
          : null;
        const [target, key] = isNodeOfType(parent, "CallExpression") ? parent.arguments : [];
        if (
          !isNodeOfType(receiver, "MemberExpression") ||
          receiver.computed ||
          !isNodeOfType(receiver.object, "Identifier") ||
          receiver.object.name !== "Object" ||
          !module.scopes.isGlobalReference(receiver.object) ||
          getStaticPropertyName(receiver) !== "defineProperty" ||
          target !== root ||
          !isNodeOfType(key, "Literal") ||
          typeof key.value !== "string" ||
          protectedNames.has(key.value)
        )
          supported = false;
        return;
      }
      if (node.name !== "Object") return;
      if (
        isNodeOfType(parent, "BinaryExpression") &&
        ["===", "!==", "==", "!="].includes(parent.operator)
      )
        return;
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== root ||
        isMemberMutationTarget(parent)
      ) {
        supported = false;
        return false;
      }
      const name = getResolvedStaticPropertyName(parent, module.scopes);
      if (
        !name ||
        ["setPrototypeOf", "getPrototypeOf", "create", "defineProperties"].includes(name)
      ) {
        supported = false;
        return false;
      }
      if (name === "prototype") {
        const next = parent.parent;
        if (
          !isNodeOfType(next, "MemberExpression") ||
          next.object !== parent ||
          getStaticPropertyName(next) !== "hasOwnProperty" ||
          isMemberMutationTarget(next)
        )
          supported = false;
        return;
      }
      if (name !== "assign" && name !== "defineProperty") return;
      const call = findTransparentExpressionRoot(parent).parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== findTransparentExpressionRoot(parent)
      ) {
        supported = false;
        return false;
      }
      const [, ...argumentsAfterTarget] = call.arguments;
      if (name === "defineProperty") {
        const [key] = argumentsAfterTarget;
        if (
          !isNodeOfType(key, "Literal") ||
          typeof key.value !== "string" ||
          protectedNames.has(key.value)
        )
          supported = false;
      } else {
        for (const argument of argumentsAfterTarget) {
          const properties = getOwnDataObjectProperties(stripParenExpression(argument));
          if (!properties || [...properties.keys()].some((name) => protectedNames.has(name)))
            supported = false;
        }
      }
    });
    if (!supported) return false;
    for (const constructor of constructors) {
      const allowed = new Set<EsTreeNode>();
      for (const reference of constructor.references) {
        const identifier = reference.identifier;
        if (isNonReferenceIdentifier(identifier) || isTypeScriptTypePosition(identifier)) {
          allowed.add(identifier);
          continue;
        }
        if (
          isNodeOfType(identifier.parent, "ExportSpecifier") &&
          identifier.parent.local === identifier
        ) {
          const specifier = identifier.parent;
          const declaration = specifier.parent;
          if (
            specifier.exportKind === "type" ||
            (isNodeOfType(declaration, "ExportNamedDeclaration") &&
              declaration.exportKind === "type")
          ) {
            allowed.add(identifier);
            continue;
          }
          const exportedName = isNodeOfType(specifier.exported, "Identifier")
            ? specifier.exported.name
            : isNodeOfType(specifier.exported, "Literal")
              ? specifier.exported.value
              : null;
          if (exportedName !== shape.exportedName) return false;
          allowed.add(identifier);
          continue;
        }
        const root = findTransparentExpressionRoot(identifier);
        const creation = root.parent;
        const declaration = creation ? findTransparentExpressionRoot(creation).parent : null;
        if (
          !isNodeOfType(creation, "NewExpression") ||
          creation.callee !== root ||
          creation.arguments.length !== IMPORTED_TIMER_CONSTRUCTOR_ARGUMENT_COUNT ||
          !isNodeOfType(declaration, "VariableDeclarator") ||
          !isNodeOfType(declaration.id, "Identifier") ||
          !isNodeOfType(declaration.parent, "VariableDeclaration") ||
          declaration.parent.kind !== "const"
        )
          return false;
        const instance = module.scopes.symbolFor(declaration.id);
        if (!instance || hasSymbolBindingWrites(instance)) return false;
        if (module === lifetime.module && instance === local) {
          allowed.add(identifier);
          continue;
        }
        const instanceReads = new Set<EsTreeNode>();
        for (const read of instance.references) {
          const value = findTransparentExpressionRoot(read.identifier);
          const member = value.parent;
          if (
            isNonReferenceIdentifier(read.identifier) ||
            isTypeScriptTypePosition(read.identifier)
          ) {
            instanceReads.add(read.identifier);
            continue;
          }
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== value ||
            member.computed ||
            member.optional ||
            isMemberMutationTarget(member)
          )
            return false;
          const name = getStaticPropertyName(member);
          if (name === shape.delayField) {
            instanceReads.add(read.identifier);
            continue;
          }
          const invocation = findTransparentExpressionRoot(member).parent;
          if (
            (name !== shape.scheduleName && name !== shape.cancelName) ||
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.callee !== findTransparentExpressionRoot(member) ||
            invocation.optional ||
            invocation.arguments.length
          )
            return false;
          instanceReads.add(read.identifier);
        }
        if (
          !hasOnlyAllowedSymbolReads({
            symbol: instance,
            scopes: module.scopes,
            program: module.programNode,
            allowedIdentifiers: instanceReads,
          })
        )
          return false;
        allowed.add(identifier);
      }
      if (
        !hasOnlyAllowedSymbolReads({
          symbol: constructor,
          scopes: module.scopes,
          program: module.programNode,
          allowedIdentifiers: allowed,
        })
      )
        return false;
    }
  }
  return !hasSymbolBindingWrites(carrier.state);
};

export const findImportedTimerClassLifetimeLeak = (
  effect: EsTreeNode,
  callback: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (
    !context.filename ||
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !(
      isProvenUnmodifiedReactApiCall(effect, "useEffect", context.scopes) ||
      isProvenUnmodifiedReactApiCall(effect, "useLayoutEffect", context.scopes)
    )
  )
    return null;
  const candidates: EsTreeNodeOfType<"NewExpression">[] = [];
  let returnsValue = false;
  walkInsideStatementBlocks(callback.body, (node) => {
    if (isNodeOfType(node, "ReturnStatement") && node.argument) returnsValue = true;
    if (
      isNodeOfType(node, "NewExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.arguments.length === IMPORTED_TIMER_CONSTRUCTOR_ARGUMENT_COUNT &&
      context.scopes.symbolFor(node.callee)?.kind === "import" &&
      isNodeReachableWithinFunction(node, context)
    )
      candidates.push(node);
  });
  if (returnsValue || !candidates.length) return null;
  const filename = path.resolve(context.filename);
  const rootDirectory = findNearestPackageDirectory(filename);
  const program = context.scopes.rootScope.node;
  if (
    !rootDirectory ||
    !isNodeOfType(program, "Program") ||
    !hasImportedTimerReactSourceConfiguration(filename)
  )
    return null;
  for (const creation of candidates) {
    const [delay, callbackArgument] = creation.arguments;
    if (
      !isFunctionLike(callbackArgument) ||
      callbackArgument.async ||
      callbackArgument.generator ||
      !(
        isNodeOfType(delay, "Identifier") ||
        (isNodeOfType(delay, "Literal") && typeof delay.value === "number")
      )
    )
      continue;
    if (isNodeOfType(delay, "Identifier")) {
      let value: EsTreeNode = delay;
      let numericData = false;
      const visited = new Set<SymbolDescriptor>();
      while (isNodeOfType(value, "Identifier")) {
        const symbol = context.scopes.symbolFor(value);
        if (!symbol || hasSymbolBindingWrites(symbol) || visited.has(symbol)) break;
        visited.add(symbol);
        if (symbol.kind === "parameter") {
          if (!symbol.initializer && !isNodeOfType(symbol.bindingIdentifier.parent, "RestElement"))
            numericData = true;
          break;
        }
        const initializer =
          getDirectUnreassignedInitializer(symbol) ??
          (isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
          isNodeOfType(symbol.declarationNode.id, "ObjectPattern")
            ? symbol.initializer
            : null);
        if (!initializer) break;
        value = stripParenExpression(initializer);
        if (isNodeOfType(value, "Literal") && typeof value.value === "number") numericData = true;
      }
      if (!numericData) continue;
    }
    const declaration = findTransparentExpressionRoot(creation).parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(creation.callee, "Identifier")
    )
      continue;
    const local = context.scopes.symbolFor(declaration.id);
    const imported = context.scopes.symbolFor(creation.callee);
    const importDeclaration = imported ? getImportDeclarationForSymbol(imported) : null;
    const exportedName =
      imported && isNodeOfType(imported.declarationNode, "ImportDefaultSpecifier")
        ? "default"
        : imported
          ? getImportedName(imported.declarationNode)
          : null;
    if (
      !local ||
      !imported ||
      hasSymbolBindingWrites(imported) ||
      !importDeclaration ||
      importDeclaration.importKind === "type" ||
      !exportedName ||
      typeof importDeclaration.source.value !== "string" ||
      !importDeclaration.source.value.startsWith(".")
    )
      continue;
    const index = buildSourceProjectIndex({
      rootDirectory,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      includeApplicationDirectories: true,
      sourceFileLimits: {
        maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
        maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
        maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
        maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
      },
    });
    if (
      !index ||
      index.hasOpaqueMdxConsumerSurface ||
      [...index.unresolvedRuntimeSources].some(
        (source) =>
          source.startsWith(".") ||
          source.startsWith("/") ||
          source.startsWith("#") ||
          source.startsWith("@/"),
      )
    )
      continue;
    const resolved = resolveCrossFileValueExportWithFilePath(
      filename,
      importDeclaration.source.value,
      exportedName,
      { requireCompleteReexports: true },
    );
    if (!resolved || !resolved.contexts) continue;
    const [resolvedContext, ...extraContexts] = resolved.contexts;
    if (!resolvedContext || extraContexts.length) continue;
    const classModule = index.modulesByFilePath.get(resolved.filePath);
    const module = index.modulesByFilePath.get(filename);
    if (!classModule || !module || !hasImportedTimerReactSourceConfiguration(classModule.filePath))
      continue;
    const exported = findExportedValue(classModule.programNode, exportedName);
    const shape = exported
      ? getImportedTimerClassSummary(exported, classModule, exportedName)
      : null;
    if (!shape) continue;
    const carrier = getImportedTimerStateCarrier(creation, local, callback, module, shape);
    if (!carrier) continue;
    const lifetime: ImportedTimerClassLifetime = { shape, module, callback, local, carrier };
    if (hasClosedTimerInstanceReads(lifetime) && hasClosedImportedTimerProviders(index, lifetime))
      return "setTimeout";
  }
  return null;
};
