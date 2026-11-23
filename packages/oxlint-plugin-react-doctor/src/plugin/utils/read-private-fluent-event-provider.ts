import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

type Call = EsTreeNodeOfType<"CallExpression">;
type MethodName = "on" | "off" | "emit";
type StableEventKey = string | number | boolean | null | SymbolDescriptor;

interface MemberCall {
  readonly node: Call;
  readonly receiver: EsTreeNode;
  readonly arguments: ReadonlyArray<EsTreeNode>;
}

export interface SelectedNamedRuntimeExport {
  readonly module: SourceProjectModule;
  readonly exportName: string;
}

export type PrivateFluentEventProvider = SelectedNamedRuntimeExport;

// The caller supplies the effective package and export proof. In particular,
// native Map/Set, the selected build source, and the receiver's visibility
// through public entries are facts the local provider grammar cannot supply.
export interface FluentEventBoundary {
  readonly resolvePrivateProvider: (
    receiver: SymbolDescriptor,
  ) => PrivateFluentEventProvider | null;
  readonly readInlinedEnumKey: (expression: EsTreeNode) => string | number | undefined;
}

const isRelativeNamedImport = (symbol: SymbolDescriptor): boolean => {
  const declaration = getValueImportDeclaration(symbol);
  return (
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    typeof declaration.source.value === "string" &&
    /^\.\.?\//u.test(declaration.source.value)
  );
};

const isReadOnly = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean =>
  hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) &&
  symbol.references.every(
    ({ identifier, flag }) => flag === "read" && !isWithinAssignmentTarget(identifier),
  );

const readMemberCall = (
  expression: EsTreeNode | null | undefined,
  method: string,
  count: number,
): MemberCall | null => {
  if (!expression) return null;
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "CallExpression") || node.optional || node.arguments.length !== count)
    return null;
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== method ||
    !node.arguments.every(
      (argument) => isAstNode(argument) && !isNodeOfType(argument, "SpreadElement"),
    )
  )
    return null;
  return { node, receiver: callee.object, arguments: node.arguments };
};

const isBindingRead = (
  expression: EsTreeNode | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const node = expression && stripParenExpression(expression);
  return isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;
};

const isOwnMapCall = (
  call: MemberCall | null,
  map: SymbolDescriptor,
  event: SymbolDescriptor,
  scopes: ScopeAnalysis,
): call is MemberCall =>
  call !== null &&
  isBindingRead(call.receiver, map, scopes) &&
  isBindingRead(call.arguments[0], event, scopes);

const isStockConstruction = (
  expression: EsTreeNode | null | undefined,
  name: "Map" | "Set",
  argumentCount: number,
  scopes: ScopeAnalysis,
): expression is EsTreeNodeOfType<"NewExpression"> =>
  isNodeOfType(expression, "NewExpression") &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === name &&
  scopes.isGlobalReference(expression.callee) &&
  expression.arguments.length === argumentCount;

const readMethodOperation = (property: EsTreeNode, module: SourceProjectModule) => {
  if (
    !isNodeOfType(property, "Property") ||
    property.kind !== "init" ||
    property.computed ||
    !property.method ||
    !isNodeOfType(property.value, "FunctionExpression")
  )
    return null;
  const method = property.value;
  if (
    method.async ||
    method.generator ||
    method.params.length !== 2 ||
    !method.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
    method.body.body.length !== 2
  )
    return null;
  const [operation, returned] = method.body.body;
  if (
    !isNodeOfType(operation, "ExpressionStatement") ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ThisExpression")
  )
    return null;
  const event = module.scopes.symbolFor(method.params[0]!);
  const value = module.scopes.symbolFor(method.params[1]!);
  return event && value && isReadOnly(event, module) && isReadOnly(value, module)
    ? { expression: stripParenExpression(operation.expression), event, value }
    : null;
};

const isExactMapOperation = (
  name: MethodName,
  property: EsTreeNode,
  map: SymbolDescriptor,
  module: SourceProjectModule,
): boolean => {
  const operation = readMethodOperation(property, module);
  if (!operation) return false;
  const { expression, event, value } = operation;
  const { scopes } = module;
  const getMatchingSet = (node: EsTreeNode): boolean =>
    isOwnMapCall(readMemberCall(node, "get", 1), map, event, scopes);

  if (name === "on") {
    if (
      !isNodeOfType(expression, "ConditionalExpression") ||
      !isOwnMapCall(readMemberCall(expression.test, "has", 1), map, event, scopes)
    )
      return false;
    const add = readMemberCall(expression.consequent, "add", 1);
    const set = readMemberCall(expression.alternate, "set", 2);
    if (
      !add ||
      !getMatchingSet(add.receiver) ||
      !isBindingRead(add.arguments[0], value, scopes) ||
      !isOwnMapCall(set, map, event, scopes)
    )
      return false;
    const newSet = set.arguments[1] && stripParenExpression(set.arguments[1]);
    if (!isStockConstruction(newSet, "Set", 1, scopes)) return false;
    const items = newSet.arguments[0];
    return (
      isNodeOfType(items, "ArrayExpression") &&
      items.elements.length === 1 &&
      isBindingRead(items.elements[0] ?? undefined, value, scopes)
    );
  }

  if (
    !isNodeOfType(expression, "LogicalExpression") ||
    expression.operator !== "&&" ||
    !isOwnMapCall(readMemberCall(expression.left, "has", 1), map, event, scopes)
  )
    return false;
  const call = readMemberCall(expression.right, name === "off" ? "delete" : "forEach", 1);
  if (!call || !getMatchingSet(call.receiver)) return false;
  if (name === "off") return isBindingRead(call.arguments[0], value, scopes);

  // Emit invokes each registered handler as a bare call, so the receiver and
  // the stored collection never reach the callback.
  const iterator = call.arguments[0] && stripParenExpression(call.arguments[0]);
  if (
    !isNodeOfType(iterator, "ArrowFunctionExpression") ||
    iterator.async ||
    iterator.params.length !== 1 ||
    !isNodeOfType(iterator.params[0], "Identifier") ||
    !isNodeOfType(iterator.body, "BlockStatement") ||
    iterator.body.body.length !== 1
  )
    return false;
  const invocationStatement = iterator.body.body[0];
  const handler = scopes.symbolFor(iterator.params[0]);
  if (
    !handler ||
    !isReadOnly(handler, module) ||
    !isNodeOfType(invocationStatement, "ExpressionStatement")
  )
    return false;
  const invocation = stripParenExpression(invocationStatement.expression);
  return (
    isNodeOfType(invocation, "CallExpression") &&
    !invocation.optional &&
    invocation.arguments.length === 1 &&
    isBindingRead(invocation.callee, handler, scopes) &&
    isBindingRead(invocation.arguments[0], value, scopes)
  );
};

export const readPrivateFluentEventProviderMethods = ({
  module,
  exportName,
}: PrivateFluentEventProvider): ReadonlySet<MethodName> | null => {
  const { scopes } = module;
  const owner = scopes.rootScope.symbolsByName.get(exportName);
  if (
    owner?.kind !== "const" ||
    !isReadOnly(owner, module) ||
    owner.references.length !== 0 ||
    !isNodeOfType(owner.declarationNode.parent?.parent, "ExportNamedDeclaration")
  )
    return null;
  const initialization = owner.initializer && stripParenExpression(owner.initializer);
  if (
    !isNodeOfType(initialization, "CallExpression") ||
    initialization.optional ||
    initialization.arguments.length !== 0 ||
    !isNodeOfType(initialization.callee, "Identifier")
  )
    return null;
  const factory = scopes.symbolFor(initialization.callee);
  const declaration = factory?.declarationNode;
  if (
    !factory ||
    !isReadOnly(factory, module) ||
    factory.references.length !== 1 ||
    factory.references[0]?.identifier !== initialization.callee ||
    !isNodeOfType(declaration, "FunctionDeclaration") ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 0 ||
    declaration.body?.body.length !== 2 ||
    declaration.parent !== module.programNode
  )
    return null;
  const [storage, returned] = declaration.body.body;
  if (
    !isNodeOfType(storage, "VariableDeclaration") ||
    storage.kind !== "const" ||
    storage.declarations.length !== 1 ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ObjectExpression")
  )
    return null;
  const binding = storage.declarations[0];
  if (
    !binding ||
    !isNodeOfType(binding.id, "Identifier") ||
    !isStockConstruction(binding.init, "Map", 0, scopes)
  )
    return null;
  const map = scopes.symbolFor(binding.id);
  if (!map || !isReadOnly(map, module)) return null;
  const methods = new Set<MethodName>();
  for (const property of returned.argument.properties) {
    const key = getStaticPropertyKeyName(property);
    if (
      (key !== "on" && key !== "off" && key !== "emit") ||
      methods.has(key) ||
      !isExactMapOperation(key, property, map, module)
    )
      return null;
    methods.add(key);
  }
  return methods.has("on") && methods.has("off") ? methods : null;
};

// This predicate can be used by the shared package/export check to classify
// read-only references. It does not establish that no more references exist.
export const isDiscardedFluentEventReceiverUse = (
  reference: EsTreeNode,
  methods: ReadonlySet<MethodName>,
): boolean => {
  let receiver = reference;
  let verb: MethodName | undefined;
  for (let depth = 0; depth < 2; depth += 1) {
    const member = receiver.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== receiver ||
      !isNodeOfType(member.property, "Identifier")
    )
      return false;
    const name = member.property.name;
    if (
      (name !== "on" && name !== "off" && name !== "emit") ||
      !methods.has(name) ||
      (verb !== undefined && name !== verb)
    )
      return false;
    const call = member.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== member) return false;
    const arity = name === "emit" ? call.arguments.length : 2;
    if ((arity !== 1 && arity !== 2) || !readMemberCall(call, name, arity)) return false;
    if (isNodeOfType(call.parent, "ExpressionStatement")) return true;
    receiver = call;
    verb = name;
  }
  return false;
};

// Only call this after the effective emitter and the unique relative import
// edge are established. A single nonambient const-enum member suffices for
// this use case, so no evaluator for inferred enum sequences is needed.
export const readSelectedConstEnumPrimitive = (
  expression: EsTreeNode,
  consumer: SourceProjectModule,
  resolveSelectedExport: (binding: SymbolDescriptor) => SelectedNamedRuntimeExport | null,
): string | number | undefined => {
  const node = stripParenExpression(expression);
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.optional ||
    node.computed ||
    !isNodeOfType(node.object, "Identifier") ||
    !isNodeOfType(node.property, "Identifier")
  )
    return undefined;
  const binding = consumer.scopes.symbolFor(node.object);
  if (!binding || !isRelativeNamedImport(binding) || !isReadOnly(binding, consumer))
    return undefined;
  const selected = resolveSelectedExport(binding);
  if (!selected) return undefined;
  const enumSymbol = selected.module.scopes.rootScope.symbolsByName.get(selected.exportName);
  const declaration = enumSymbol?.declarationNode;
  if (
    enumSymbol?.kind !== "ts-enum" ||
    !isNodeOfType(declaration, "TSEnumDeclaration") ||
    !declaration.const ||
    declaration.declare ||
    declaration.body?.members.length !== 1 ||
    !isNodeOfType(declaration.parent, "ExportNamedDeclaration")
  )
    return undefined;
  const member = declaration.body.members[0];
  if (!member || !isNodeOfType(member.id, "Identifier") || member.id.name !== node.property.name)
    return undefined;
  if (!member.initializer) return 0;
  return isNodeOfType(member.initializer, "Literal") &&
    (typeof member.initializer.value === "string" || typeof member.initializer.value === "number")
    ? member.initializer.value
    : undefined;
};

const readEventKey = (
  expression: EsTreeNode | undefined,
  owner: EsTreeNode,
  module: SourceProjectModule,
  boundary: FluentEventBoundary,
): StableEventKey | undefined => {
  if (!expression) return undefined;
  const node = stripParenExpression(expression);
  if (
    isNodeOfType(node, "Literal") &&
    (node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean")
  )
    return node.value;
  if (isNodeOfType(node, "Identifier")) {
    const symbol = module.scopes.symbolFor(node);
    return symbol?.kind === "parameter" &&
      findEnclosingFunction(symbol.bindingIdentifier) === owner &&
      isReadOnly(symbol, module)
      ? symbol
      : undefined;
  }
  return isNodeOfType(node, "MemberExpression") && !node.computed && !node.optional
    ? boundary.readInlinedEnumKey(node)
    : undefined;
};

const readHandler = (
  expression: EsTreeNode | undefined,
  owner: EsTreeNode,
  module: SourceProjectModule,
): SymbolDescriptor | null => {
  const node = expression && stripParenExpression(expression);
  if (!isNodeOfType(node, "Identifier")) return null;
  const binding = module.scopes.symbolFor(node);
  return binding?.kind === "function" &&
    isNodeOfType(binding.declarationNode, "FunctionDeclaration") &&
    findEnclosingFunction(binding.declarationNode) === owner &&
    isReadOnly(binding, module)
    ? binding
    : null;
};

const readEffectChain = (
  statement: EsTreeNode | undefined,
  verb: "on" | "off",
  scopes: ScopeAnalysis,
) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const second = readMemberCall(statement.expression, verb, 2);
  const first = second && readMemberCall(second.receiver, verb, 2);
  if (!first || !second || !isNodeOfType(first.receiver, "Identifier")) return null;
  const receiver = scopes.symbolFor(first.receiver);
  return receiver ? { receiver, first, second } : null;
};

export const readBalancedPrivateFluentEventRegistrations = (
  callback: EsTreeNode,
  module: SourceProjectModule,
  boundary: FluentEventBoundary,
): ReadonlyArray<Call> => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 2
  )
    return [];
  const [setupStatement, returned] = callback.body.body;
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ArrowFunctionExpression")
  )
    return [];
  const cleanup = returned.argument;
  if (
    cleanup.async ||
    cleanup.params.length !== 0 ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== 1
  )
    return [];
  const owner = findEnclosingFunction(callback);
  if (!owner) return [];
  const setup = readEffectChain(setupStatement, "on", module.scopes);
  const release = readEffectChain(cleanup.body.body[0], "off", module.scopes);
  if (
    !setup ||
    !release ||
    setup.receiver !== release.receiver ||
    !isRelativeNamedImport(setup.receiver) ||
    !isReadOnly(setup.receiver, module)
  )
    return [];
  for (const position of ["first", "second"] as const) {
    const registered = setup[position].arguments;
    const released = release[position].arguments;
    const handler = readHandler(registered[1], owner, module);
    if (!handler || handler !== readHandler(released[1], owner, module)) return [];
    const key = readEventKey(registered[0], owner, module, boundary);
    if (key === undefined || key !== readEventKey(released[0], owner, module, boundary)) return [];
  }
  const provider = boundary.resolvePrivateProvider(setup.receiver);
  if (!provider) return [];
  const methods = readPrivateFluentEventProviderMethods(provider);
  if (
    !methods ||
    !setup.receiver.references.every(({ identifier }) =>
      isDiscardedFluentEventReceiverUse(identifier, methods),
    )
  )
    return [];
  return [setup.first.node, setup.second.node];
};
