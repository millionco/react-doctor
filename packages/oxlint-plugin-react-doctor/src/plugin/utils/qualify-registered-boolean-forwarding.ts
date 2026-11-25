import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type {
  BoundNode,
  NamedViteOmittedBooleanProjection,
} from "./project-named-vite-omitted-boolean.js";
import {
  asObject,
  bindingUses,
  hasUniquePlainFields,
  lexical,
  matchValue,
  onlyUsedAt,
  onlyValueUses,
  ownProperty,
  patternRest,
  sameValue,
} from "./project-named-vite-omitted-boolean.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ConsumerTarget {
  readonly dependencyOffset: number;
  readonly dependencyLength: number;
  readonly bindingOffset: number;
  readonly recordField: string;
  readonly booleanField: string;
}
interface DirectConsumer {
  readonly component: BoundNode;
  readonly read: EsTreeNode;
  readonly binding: SymbolDescriptor;
}
interface ModuleRegistration {
  readonly key: string;
  readonly plugin: BoundNode;
  readonly factory: BoundNode;
  readonly moduleFields: readonly [string, string];
  readonly handler: BoundNode;
  readonly delegated: EsTreeNodeOfType<"CallExpression">;
  readonly moduleId: string;
}
interface CarrierSpread {
  readonly wrapper: BoundNode;
  readonly provider: BoundNode;
  readonly context: BoundNode;
}
export type { ConsumerTarget };
export interface RegisteredBooleanForwarding {
  readonly selected: DirectConsumer;
  readonly registered: ModuleRegistration;
  readonly wrapper: CarrierSpread | null;
  readonly renderFunction: BoundNode;
  readonly renderExpression: BoundNode;
  readonly graphField: string;
  readonly rootFactory: BoundNode;
  readonly rootModuleValue: BoundNode;
  readonly nodeFields: readonly [string, string];
  readonly graphComponents: readonly BoundNode[];
}

const one = <T>(xs: readonly T[]): T | undefined => (xs.length === 1 ? xs[0] : undefined);
const match = (
  module: NamedViteSourceModule,
  node: EsTreeNode | null | undefined,
  known: EsTreeNode | null | undefined,
): boolean => {
  const binding = known && lexical(module, known);
  return Boolean(node && binding && lexical(module, node) === binding);
};
const propertyOwner = (node: EsTreeNode | null | undefined, name: string) => {
  const value = node && stripParenExpression(node);
  return isNodeOfType(value, "MemberExpression") && getStaticPropertyName(value) === name
    ? value.object
    : null;
};
const isStockCall = (
  module: NamedViteSourceModule,
  call: EsTreeNode | null,
  name: string,
): call is EsTreeNodeOfType<"CallExpression"> => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    getStaticPropertyName(call.callee) !== name ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    lexical(module, call.callee.object)?.kind !== "import"
  )
    return false;
  const provider = resolveImportedApiReference(call.callee.object, module.scopes);
  return provider?.source === "react" && provider.isNamespace;
};
const asCall = (node: EsTreeNode | null | undefined, argCount: number) => {
  const value = node && stripParenExpression(node);
  return isNodeOfType(value, "CallExpression") &&
    !value.optional &&
    value.arguments.length === argCount
    ? value
    : null;
};
const asIdentifier = (node: EsTreeNode | null | undefined) =>
  isNodeOfType(node, "Identifier") ? node : null;
const onlyArrayItem = (node: EsTreeNode | null | undefined) => {
  const value = node && stripParenExpression(node);
  return isNodeOfType(value, "ArrayExpression") ? (one(value.elements) ?? null) : null;
};
const exactReturn = (bound: BoundNode | null) => {
  if (!bound || !isFunctionLike(bound.node) || bound.node.async || bound.node.generator)
    return null;
  const value = getSingleReturnExpression(bound.node);
  return value ? stripParenExpression(value) : null;
};
const exactStatement = (bound: BoundNode | null) => {
  if (!bound || !isFunctionLike(bound.node) || bound.node.async || bound.node.generator)
    return null;
  if (!isNodeOfType(bound.node.body, "BlockStatement"))
    return stripParenExpression(bound.node.body);
  const statement = one(bound.node.body.body);
  return isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;
};
const ids = (bound: BoundNode | null, count: number) => {
  if (
    !bound ||
    !isFunctionLike(bound.node) ||
    bound.node.async ||
    bound.node.generator ||
    bound.node.params.length !== count
  )
    return null;
  const plain = bound.node.params.map(asIdentifier);
  return plain.every((parameter) => parameter !== null) ? plain : null;
};
const find = (root: EsTreeNode, predicate: (node: EsTreeNode) => boolean): EsTreeNode[] => {
  const nodes: EsTreeNode[] = [];
  walkAst(root, (node) => {
    if (predicate(node)) nodes.push(node);
  });
  return nodes;
};
const literalName = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  value: EsTreeNode | null | undefined,
): string | null => {
  const source =
    value && (isNodeOfType(value, "Literal") ? value : matchValue(project, module, value)?.node);
  return isNodeOfType(source, "Literal") && typeof source.value === "string" ? source.value : null;
};

const selectedEffectConsumer = (
  project: NamedViteSourceProject,
  target: ConsumerTarget,
): DirectConsumer | null => {
  const module = project.modulesByFilePath.get(project.focal);
  if (!module) return null;
  const effect = one(
    find(module.programNode, (node) => {
      if (
        !isStockCall(module, node, "useEffect") ||
        node.arguments.length !== 2 ||
        !isNodeOfType(node.arguments[1], "ArrayExpression")
      )
        return false;
      const deps = node.arguments[1];
      const start = getNodeStartIndex(deps);
      const end = "end" in deps && typeof deps.end === "number" ? deps.end : -1;
      return start === target.dependencyOffset && end - start === target.dependencyLength;
    }),
  );
  if (
    !isNodeOfType(effect, "CallExpression") ||
    !isNodeOfType(effect.arguments[0], "ArrowFunctionExpression") ||
    effect.arguments[0].async
  )
    return null;
  const owner = findEnclosingFunction(effect);
  if (
    !isNodeOfType(owner, "FunctionDeclaration") ||
    !owner.id ||
    owner.async ||
    owner.generator ||
    owner.params.length !== 1 ||
    !isNodeOfType(owner.params[0], "ObjectPattern") ||
    !hasUniquePlainFields(owner.params[0], true)
  )
    return null;
  const record = ownProperty(owner.params[0], target.recordField)?.value;
  if (!isNodeOfType(record, "ObjectPattern") || !hasUniquePlainFields(record, false)) return null;
  const bit = ownProperty(record, target.booleanField)?.value;
  if (!isNodeOfType(bit, "Identifier") || getNodeStartIndex(bit) !== target.bindingOffset)
    return null;
  const binding = lexical(module, bit);
  if (!binding || binding.references.some((ref) => ref.flag !== "read")) return null;
  const uses = bindingUses(binding);
  if (
    uses.some(
      (node) =>
        !isNodeOfType(node.parent, "LogicalExpression") ||
        node.parent.operator !== "&&" ||
        node.parent.left !== node,
    )
  )
    return null;
  const callback = effect.arguments[0];
  const read = one(
    uses.filter((node) => {
      let parent = node.parent;
      while (parent && parent !== callback && !isFunctionLike(parent)) parent = parent.parent;
      return parent === callback;
    }),
  );
  return read ? { component: { module, node: owner }, read, binding } : null;
};

const dtoFields = (
  factory: BoundNode | null,
  optionalSecond = false,
): readonly [string, string] | null => {
  if (!factory || !isFunctionLike(factory.node) || factory.node.params.length !== 2) return null;
  const [first, second] = factory.node.params;
  const a = asIdentifier(first);
  const b =
    asIdentifier(second) ??
    (optionalSecond &&
    isNodeOfType(second, "AssignmentPattern") &&
    isNodeOfType(second.right, "Literal") &&
    second.right.value === null
      ? asIdentifier(second.left)
      : null);
  const object = asObject(exactReturn(factory));
  if (!a || !b || !object || !hasUniquePlainFields(object, false) || object.properties.length !== 2)
    return null;
  const fields = [a, b].map((id) => {
    const property = one(
      object.properties.filter(
        (entry) => isNodeOfType(entry, "Property") && match(factory.module, entry.value, id),
      ),
    );
    return property && getStaticPropertyKeyName(property);
  });
  return fields[0] && fields[1] ? [fields[0], fields[1]] : null;
};

const findRegistration = (
  project: NamedViteSourceProject,
  projection: NamedViteOmittedBooleanProjection,
  selected: DirectConsumer,
): ModuleRegistration | null => {
  const matches = projection.plugins.flatMap((plugin) => {
    if (
      !isFunctionLike(plugin.node) ||
      !isNodeOfType(plugin.node.body, "BlockStatement") ||
      !isNodeOfType(plugin.node.params[0], "ObjectPattern")
    )
      return [];
    const module = plugin.module;
    const pattern = plugin.node.params[0];
    return plugin.node.body.body.flatMap((statement) => {
      if (!isNodeOfType(statement, "ExpressionStatement")) return [];
      const call = asCall(statement.expression, 1);
      const dto = call && asCall(call.arguments[0], 2);
      if (
        !call ||
        !dto ||
        !isNodeOfType(call.callee, "Identifier") ||
        !isNodeOfType(dto.arguments[1], "Identifier") ||
        !sameValue(matchValue(project, module, dto.arguments[1]), selected.component)
      )
        return [];
      return [{ plugin, call, dto, pattern }];
    });
  });
  const candidate = one(matches);
  if (!candidate) return null;
  const { plugin, call, dto, pattern } = candidate;
  const slot = one(
    pattern.properties.filter(
      (node) => isNodeOfType(node, "Property") && match(plugin.module, node.value, call.callee),
    ),
  );
  const key = slot && getStaticPropertyKeyName(slot);
  if (
    !key ||
    !onlyUsedAt(lexical(plugin.module, call.callee), call.callee) ||
    !onlyValueUses(project, selected.component, (node) => node === dto.arguments[1])
  )
    return null;
  const factory = matchValue(project, plugin.module, dto.callee);
  const fields = dtoFields(factory);
  const id = literalName(project, plugin.module, dto.arguments[0]);
  const supplied = ownProperty(projection.assembly.injected, key)?.value;
  const handler = supplied && matchValue(project, projection.assembly.registrar.module, supplied);
  const named = handler && ids(handler, 1);
  const delegated = handler && asCall(exactStatement(handler), 2);
  if (
    !factory ||
    !fields ||
    !id ||
    !handler ||
    !named ||
    !delegated ||
    !match(handler.module, delegated.arguments[1], named[0])
  )
    return null;
  return { key, plugin, factory, moduleFields: fields, handler, delegated, moduleId: id };
};

const jsxChildren = (jsx: EsTreeNodeOfType<"JSXElement">) =>
  jsx.children.filter((child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "");
const verifyCarrierSpread = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  reference: EsTreeNode,
): CarrierSpread | null => {
  const spread = reference.parent;
  if (!isNodeOfType(spread, "JSXSpreadAttribute") || spread.argument !== reference) return null;
  const opening = spread.parent;
  if (!isNodeOfType(opening, "JSXOpeningElement") || opening.attributes.length !== 1) return null;
  const wrapper = matchValue(project, module, opening.name);
  if (
    !wrapper ||
    !isFunctionLike(wrapper.node) ||
    wrapper.node.params.length !== 1 ||
    !isNodeOfType(wrapper.node.params[0], "ObjectPattern")
  )
    return null;
  const pattern = wrapper.node.params[0];
  if (pattern.properties.length !== 2) return null;
  const children = ownProperty(pattern, "children")?.value;
  const rest = patternRest(pattern);
  const value = exactReturn(wrapper);
  if (
    !isNodeOfType(children, "Identifier") ||
    !rest ||
    !isNodeOfType(value, "JSXElement") ||
    !isNodeOfType(value.openingElement.name, "JSXMemberExpression") ||
    value.openingElement.name.property.name !== "Provider"
  )
    return null;
  const context = matchValue(project, wrapper.module, value.openingElement.name.object);
  if (
    !context ||
    !isStockCall(context.module, context.node, "createContext") ||
    context.node.arguments.length !== 1 ||
    !isNodeOfType(context.node.arguments[0], "Literal") ||
    context.node.arguments[0].value !== null
  )
    return null;
  const field = one(value.openingElement.attributes);
  const child = one(jsxChildren(value));
  return isNodeOfType(field, "JSXAttribute") &&
    field.name.name === "value" &&
    isNodeOfType(field.value, "JSXExpressionContainer") &&
    isNodeOfType(field.value.expression, "Identifier") &&
    onlyUsedAt(lexical(wrapper.module, rest), field.value.expression) &&
    isNodeOfType(child, "JSXExpressionContainer") &&
    isNodeOfType(child.expression, "Identifier") &&
    onlyUsedAt(lexical(wrapper.module, children), child.expression)
    ? { wrapper, provider: { module: wrapper.module, node: value }, context }
    : null;
};

interface RenderProjection {
  readonly wrapper: CarrierSpread | null;
  readonly renderFunction: BoundNode;
  readonly renderExpression: BoundNode;
  readonly graphField: string;
  readonly rootFactory: BoundNode;
  readonly rootModuleValue: BoundNode;
  readonly nodeFields: readonly [string, string];
}
const renderForwarding = (
  project: NamedViteSourceProject,
  projection: NamedViteOmittedBooleanProjection,
  registered: ModuleRegistration,
): RenderProjection | null => {
  const module = projection.owner.module;
  const uses = bindingUses(projection.assembledBinding);
  const call = one(
    uses.flatMap((use) => {
      const parent = asCall(use.parent, 2);
      return parent && parent.arguments[1] === use ? [parent] : [];
    }),
  );
  if (!call) return null;
  let wrapper: CarrierSpread | null = null;
  for (const use of uses) {
    if (use === call.arguments[1]) continue;
    const member = use.parent,
      test = member?.parent;
    if (
      isNodeOfType(member, "MemberExpression") &&
      member.object === use &&
      getStaticPropertyName(member) &&
      !isWithinAssignmentTarget(member) &&
      isNodeOfType(test, "UnaryExpression") &&
      test.operator === "!" &&
      test.argument === member
    )
      continue;
    const provider = verifyCarrierSpread(project, module, use);
    if (!provider || wrapper) return null;
    wrapper = provider;
  }
  const factory = asCall(call.arguments[0], 2);
  const renderFunction = matchValue(project, module, call.callee);
  const params = ids(renderFunction, 2);
  const rendered = exactReturn(renderFunction);
  if (
    !factory ||
    !renderFunction ||
    !params ||
    !isStockCall(renderFunction.module, rendered, "createElement") ||
    rendered.arguments.length !== 3
  )
    return null;
  const rootFactory = matchValue(project, module, factory.callee);
  const fields = dtoFields(rootFactory, true);
  if (!rootFactory || !fields) return null;
  const [moduleField, childrenField] = fields;
  const [nameField, componentField] = registered.moduleFields;
  const [node, props] = params;
  const inModule = renderFunction.module;
  const component = propertyOwner(
    propertyOwner(rendered.arguments[0], componentField),
    moduleField,
  );
  const payload = asObject(rendered.arguments[1]);
  if (
    !match(inModule, component, node) ||
    !payload ||
    !hasUniquePlainFields(payload, true) ||
    payload.properties.length !== 2 ||
    !isNodeOfType(payload.properties[1], "SpreadElement") ||
    !match(inModule, payload.properties[1].argument, props) ||
    !match(
      inModule,
      propertyOwner(propertyOwner(ownProperty(payload, "key")?.value, nameField), moduleField),
      node,
    )
  )
    return null;
  const children = rendered.arguments[2];
  const map = asCall(isNodeOfType(children, "ChainExpression") ? children.expression : children, 1);
  const mapper = map?.arguments[0];
  const mapperInfo = isNodeOfType(mapper, "ArrowFunctionExpression")
    ? { module: inModule, node: mapper }
    : null;
  const mapperArgs = ids(mapperInfo, 1);
  const recursive = asCall(exactReturn(mapperInfo), 2);
  const propsSymbol = props && lexical(inModule, props);
  if (
    !map ||
    !mapperArgs ||
    !recursive ||
    !propsSymbol ||
    bindingUses(propsSymbol).length !== 2 ||
    !match(inModule, propertyOwner(propertyOwner(map.callee, "map"), childrenField), node) ||
    !match(inModule, recursive.arguments[0], mapperArgs[0]) ||
    !match(inModule, recursive.arguments[1], props) ||
    !sameValue(matchValue(project, inModule, recursive.callee), renderFunction)
  )
    return null;
  const declaration = lexical(module, factory.arguments[1])?.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== projection.assemblyCall ||
    !isNodeOfType(declaration.id, "ObjectPattern")
  )
    return null;
  const rootModuleValue = matchValue(project, module, factory.arguments[0]);
  if (
    !rootModuleValue ||
    !onlyValueUses(project, rootModuleValue, (use) => use === factory.arguments[0])
  )
    return null;
  const graphField = one(
    declaration.id.properties.flatMap((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        !match(module, property.value, factory.arguments[1])
      )
        return [];
      const name = getStaticPropertyKeyName(property);
      return name ? [name] : [];
    }),
  );
  return graphField
    ? {
        wrapper,
        renderFunction,
        renderExpression: { module, node: call },
        graphField,
        rootFactory,
        rootModuleValue,
        nodeFields: fields,
      }
    : null;
};

const onlyReturnOf = (branch: EsTreeNode | null | undefined) => {
  const body = isNodeOfType(branch, "BlockStatement") ? one(branch.body) : branch;
  return isNodeOfType(body, "ReturnStatement") ? (body.argument ?? null) : null;
};
const mapCallback = (
  module: NamedViteSourceModule,
  operand: EsTreeNode,
  sought: EsTreeNode,
): { readonly fn: BoundNode; readonly call: EsTreeNodeOfType<"CallExpression"> } | null => {
  const map = asCall(operand, 1);
  const mapper = map?.arguments[0];
  const wrapped = isNodeOfType(mapper, "ArrowFunctionExpression") ? { module, node: mapper } : null;
  const formals = ids(wrapped, 1);
  const expression = wrapped && exactReturn(wrapped);
  if (
    !map ||
    !wrapped ||
    !formals ||
    !match(module, propertyOwner(map.callee, "flatMap"), sought) ||
    !isNodeOfType(expression, "LogicalExpression") ||
    expression.operator !== "??" ||
    !isNodeOfType(expression.right, "ArrayExpression") ||
    expression.right.elements.length
  )
    return null;
  const invoke = asCall(expression.left, 3);
  return invoke && match(module, invoke.arguments[0], formals[0])
    ? { fn: wrapped, call: invoke }
    : null;
};

const validateTraversal = (
  project: NamedViteSourceProject,
  fn: BoundNode | null,
  registration: ModuleRegistration,
  render: RenderProjection,
): boolean => {
  const formals = ids(fn, 3);
  const walk = exactReturn(fn);
  if (!fn || !formals || !walk) return false;
  const program = fn.module;
  const step = mapCallback(program, walk, formals[0]!);
  if (
    !step ||
    !match(program, step.call.arguments[1], formals[1]) ||
    !match(program, step.call.arguments[2], formals[2])
  )
    return false;
  const seek = matchValue(project, program, step.call.callee);
  const names = ids(seek, 3);
  if (
    !seek ||
    !names ||
    !isFunctionLike(seek.node) ||
    !isNodeOfType(seek.node.body, "BlockStatement") ||
    seek.node.body.body.length !== 3
  )
    return false;
  const scoped = seek.module;
  const [node, key, apply] = names;
  const [matched, descend, fallback] = seek.node.body.body;
  const [moduleField, childrenField] = render.nodeFields;
  const [nameField] = registration.moduleFields;
  if (
    !isNodeOfType(matched, "IfStatement") ||
    matched.alternate ||
    !isNodeOfType(matched.test, "BinaryExpression") ||
    matched.test.operator !== "===" ||
    !match(scoped, matched.test.right, key) ||
    !match(scoped, propertyOwner(propertyOwner(matched.test.left, nameField), moduleField), node)
  )
    return false;
  const rewrite = asCall(onlyReturnOf(matched.consequent), 1);
  if (
    !rewrite ||
    !match(scoped, rewrite.callee, apply) ||
    !match(scoped, rewrite.arguments[0], node) ||
    !match(scoped, onlyArrayItem(onlyReturnOf(fallback)), node) ||
    !isNodeOfType(descend, "IfStatement") ||
    descend.alternate ||
    !match(scoped, propertyOwner(descend.test, childrenField), node)
  )
    return false;
  const nested = asCall(onlyArrayItem(onlyReturnOf(descend.consequent)), 2);
  if (
    !nested ||
    !sameValue(matchValue(project, scoped, nested.callee), render.rootFactory) ||
    !match(scoped, propertyOwner(nested.arguments[0], moduleField), node)
  )
    return false;
  const mapped = asCall(nested.arguments[1], 1);
  const mapper = mapped?.arguments[0];
  const mapperFn = isNodeOfType(mapper, "ArrowFunctionExpression")
    ? { module: scoped, node: mapper }
    : null;
  const arg = ids(mapperFn, 1);
  const call = exactReturn(mapperFn);
  const recurse =
    isNodeOfType(call, "LogicalExpression") &&
    call.operator === "??" &&
    isNodeOfType(call.right, "ArrayExpression") &&
    !call.right.elements.length
      ? asCall(call.left, 3)
      : null;
  return Boolean(
    mapped &&
    arg &&
    recurse &&
    match(scoped, propertyOwner(propertyOwner(mapped.callee, "flatMap"), childrenField), node) &&
    sameValue(matchValue(project, scoped, recurse.callee), seek) &&
    match(scoped, recurse.arguments[0], arg[0]) &&
    match(scoped, recurse.arguments[1], key) &&
    match(scoped, recurse.arguments[2], apply),
  );
};

interface RegistryTransition {
  readonly storage: SymbolDescriptor;
  readonly traverse: BoundNode;
  readonly append: BoundNode;
  readonly anchor: string;
}
const validateInsertion = (
  project: NamedViteSourceProject,
  projection: NamedViteOmittedBooleanProjection,
  registration: ModuleRegistration,
  render: RenderProjection,
): RegistryTransition | null => {
  const module = registration.handler.module;
  const append = matchValue(project, module, registration.delegated.callee);
  const formals = ids(append, 2);
  const change = exactStatement(append);
  if (
    !append ||
    !formals ||
    !isNodeOfType(change, "AssignmentExpression") ||
    change.operator !== "="
  )
    return null;
  const registry = projection.assembly.registrar;
  const storage = ownProperty(projection.assembly.output, render.graphField)?.value;
  const binding = storage && lexical(registry.module, storage);
  if (
    !binding ||
    !isFunctionLike(registry.node) ||
    !isNodeOfType(registry.node.params[0], "Identifier") ||
    !match(append.module, change.left, storage) ||
    !match(registry.module, binding.initializer, registry.node.params[0])
  )
    return null;
  const traverse = asCall(change.right, 3);
  const visitor = traverse?.arguments[2];
  const transform = isNodeOfType(visitor, "ArrowFunctionExpression")
    ? { module: append.module, node: visitor }
    : null;
  const args = ids(transform, 1);
  const root = asCall(onlyArrayItem(exactReturn(transform)), 2);
  const child = root && asCall(onlyArrayItem(root.arguments[1]), 2);
  const where = append.module;
  const [moduleField, childrenField] = render.nodeFields;
  if (
    !traverse ||
    !args ||
    !root ||
    !child ||
    !match(where, traverse.arguments[0], storage) ||
    !match(where, traverse.arguments[1], formals[0]) ||
    !sameValue(matchValue(project, where, root.callee), render.rootFactory) ||
    !sameValue(matchValue(project, where, child.callee), render.rootFactory) ||
    !match(where, propertyOwner(root.arguments[0], moduleField), args[0]) ||
    !match(where, child.arguments[0], formals[1]) ||
    !match(where, propertyOwner(child.arguments[1], childrenField), args[0])
  )
    return null;
  const initial = projection.assemblyCall.arguments[0];
  const wanted = literalName(project, module, registration.delegated.arguments[0]);
  if (!wanted || !isNodeOfType(initial, "ArrayExpression") || wanted === registration.moduleId)
    return null;
  const owner = projection.owner.module;
  const anchors = find(initial, (node) => {
    const call = asCall(node, 2) ?? asCall(node, 1);
    if (!call || !sameValue(matchValue(project, owner, call.callee), render.rootFactory))
      return false;
    const bound = matchValue(project, owner, call.arguments[0]);
    const dto = bound && asCall(bound.node, 2);
    return Boolean(
      bound &&
      dto &&
      sameValue(matchValue(project, bound.module, dto.callee), registration.factory) &&
      literalName(project, bound.module, dto.arguments[0]) === wanted,
    );
  });
  const traversal = matchValue(project, where, traverse.callee);
  return anchors.length === 1 &&
    traversal &&
    validateTraversal(project, traversal, registration, render)
    ? { storage: binding, traverse: traversal, append, anchor: wanted }
    : null;
};

const expectedFactoryCall = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  input: EsTreeNode | null | undefined,
  count: number,
  factory: BoundNode,
) => {
  const call = asCall(input, count);
  return call && sameValue(matchValue(project, module, call.callee), factory) ? call : null;
};
const storageAssignment = (
  node: EsTreeNode | null | undefined,
  module: NamedViteSourceModule,
  storage: SymbolDescriptor,
) =>
  isNodeOfType(node, "AssignmentExpression") &&
  node.operator === "=" &&
  lexical(module, node.left) === storage
    ? node.right
    : null;
const callableLeaf = (candidate: BoundNode, value: EsTreeNode | null | undefined) =>
  isNodeOfType(value, "Identifier") ? lexical(candidate.module, value) : null;

type RegistryOperation = "contains" | "append" | "addModule" | "addRootWrapper" | "addChild";

const isSimpleContains = (
  handler: BoundNode,
  storage: SymbolDescriptor,
  fields: readonly [string, string],
  nameField: string,
): boolean => {
  const formal = ids(handler, 1);
  const { module, node } = handler;
  if (
    !formal ||
    !isFunctionLike(node) ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.body.body.length !== 3
  )
    return false;
  const [initial, loop, empty] = node.body.body;
  const declaration =
    isNodeOfType(initial, "VariableDeclaration") && initial.kind === "const"
      ? one(initial.declarations)
      : null;
  const spread = declaration && onlyArrayItem(declaration.init);
  const end = onlyReturnOf(empty);
  if (
    !declaration ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(spread, "SpreadElement") ||
    lexical(module, spread.argument) !== storage ||
    !isNodeOfType(loop, "WhileStatement") ||
    !isNodeOfType(loop.body, "BlockStatement") ||
    loop.body.body.length !== 3 ||
    !isNodeOfType(end, "Literal") ||
    end.value !== false
  )
    return false;
  if (
    !isNodeOfType(loop.test, "BinaryExpression") ||
    loop.test.operator !== ">" ||
    !isNodeOfType(loop.test.right, "Literal") ||
    loop.test.right.value !== 0 ||
    !match(module, propertyOwner(loop.test.left, "length"), declaration.id)
  )
    return false;
  const [step, found, descend] = loop.body.body;
  const local =
    isNodeOfType(step, "VariableDeclaration") && step.kind === "const"
      ? one(step.declarations)
      : null;
  const pop = local && asCall(local.init, 0);
  if (
    !local ||
    !isNodeOfType(local.id, "Identifier") ||
    !pop ||
    !match(module, propertyOwner(pop.callee, "pop"), declaration.id)
  )
    return false;
  if (
    !isNodeOfType(found, "IfStatement") ||
    found.alternate ||
    !isNodeOfType(found.test, "BinaryExpression") ||
    found.test.operator !== "===" ||
    !match(module, found.test.right, formal[0])
  )
    return false;
  const foundLeft = isNodeOfType(found.test.left, "ChainExpression")
    ? found.test.left.expression
    : found.test.left;
  const immediate = onlyReturnOf(found.consequent);
  if (
    !match(module, propertyOwner(propertyOwner(foundLeft, nameField), fields[0]), local.id) ||
    !isNodeOfType(immediate, "Literal") ||
    immediate.value !== true ||
    !isNodeOfType(descend, "IfStatement") ||
    descend.alternate
  )
    return false;
  const desc = isNodeOfType(descend.test, "ChainExpression")
    ? descend.test.expression
    : descend.test;
  const push = asCall(
    isNodeOfType(descend.consequent, "ExpressionStatement") ? descend.consequent.expression : null,
    1,
  );
  return Boolean(
    match(module, propertyOwner(desc, fields[1]), local.id) &&
    push &&
    match(module, propertyOwner(push.callee, "push"), declaration.id) &&
    isNodeOfType(push.arguments[0], "SpreadElement") &&
    match(module, propertyOwner(push.arguments[0].argument, fields[1]), local.id),
  );
};

const readOperation = (
  project: NamedViteSourceProject,
  handler: BoundNode,
  state: RegistryTransition,
  registration: ModuleRegistration,
  render: RenderProjection,
): RegistryOperation | null => {
  if (sameValue(handler, state.append)) return "append";
  if (sameValue(handler, registration.handler)) return "addModule";
  if (isSimpleContains(handler, state.storage, render.nodeFields, registration.moduleFields[0]))
    return "contains";
  const { node, module } = handler;
  if (
    !isFunctionLike(node) ||
    !isNodeOfType(node.body, "BlockStatement") ||
    (node.params.length !== 2 && node.params.length !== 3)
  )
    return null;
  const formal = ids(handler, node.params.length);
  const statements = node.body.body;
  if (!formal || statements.length !== (formal.length === 2 ? 2 : 1)) return null;
  const [target, added, precede] = formal;
  const tail = statements.at(-1);
  const effectiveChange = isNodeOfType(tail, "ExpressionStatement")
    ? storageAssignment(tail.expression, module, state.storage)
    : null;
  const traverse = expectedFactoryCall(project, module, effectiveChange, 3, state.traverse);
  if (
    !traverse ||
    lexical(module, traverse.arguments[0]) !== state.storage ||
    !match(module, traverse.arguments[1], target)
  )
    return null;
  const rawVisitor = traverse.arguments[2];
  const visitor = isNodeOfType(rawVisitor, "ArrowFunctionExpression")
    ? { module, node: rawVisitor }
    : null;
  const chosen = ids(visitor, 1)?.[0];
  const output = expectedFactoryCall(
    project,
    module,
    onlyArrayItem(exactReturn(visitor)),
    2,
    render.rootFactory,
  );
  if (!chosen || !output) return null;
  if (!precede) {
    const first = statements[0];
    if (
      !isNodeOfType(first, "IfStatement") ||
      first.alternate ||
      !isNodeOfType(first.test, "BinaryExpression") ||
      first.test.operator !== "===" ||
      !match(module, first.test.left, target) ||
      !isNodeOfType(first.test.right, "Literal") ||
      first.test.right.value !== "" ||
      !isNodeOfType(first.consequent, "BlockStatement") ||
      first.consequent.body.length !== 2
    )
      return null;
    const [top, stop] = first.consequent.body;
    const update = isNodeOfType(top, "ExpressionStatement")
      ? storageAssignment(top.expression, module, state.storage)
      : null;
    const root = expectedFactoryCall(project, module, onlyArrayItem(update), 2, render.rootFactory);
    return root &&
      match(module, root.arguments[0], added) &&
      lexical(module, root.arguments[1]) === state.storage &&
      isNodeOfType(stop, "ReturnStatement") &&
      !stop.argument &&
      match(module, output.arguments[0], added) &&
      match(module, onlyArrayItem(output.arguments[1]), chosen)
      ? "addRootWrapper"
      : null;
  }
  const [item, children] = output.arguments;
  if (
    !match(module, propertyOwner(item, render.nodeFields[0]), chosen) ||
    !isNodeOfType(children, "ArrayExpression") ||
    children.elements.length !== 3
  )
    return null;
  const [before, kept, after] = children.elements;
  if (
    !isNodeOfType(before, "SpreadElement") ||
    !isNodeOfType(kept, "SpreadElement") ||
    !isNodeOfType(after, "SpreadElement")
  )
    return null;
  const original = stripParenExpression(kept.argument);
  if (
    !isNodeOfType(original, "LogicalExpression") ||
    original.operator !== "??" ||
    !match(module, propertyOwner(original.left, render.nodeFields[1]), chosen) ||
    !isNodeOfType(original.right, "ArrayExpression") ||
    original.right.elements.length
  )
    return null;
  const freshBranch = (element: EsTreeNode, positive: boolean) => {
    const conditional = stripParenExpression(element);
    if (
      !isNodeOfType(conditional, "ConditionalExpression") ||
      !isNodeOfType(conditional.alternate, "ArrayExpression") ||
      conditional.alternate.elements.length
    )
      return false;
    const test = conditional.test;
    if (
      positive
        ? !match(module, test, precede)
        : !isNodeOfType(test, "UnaryExpression") ||
          test.operator !== "!" ||
          !match(module, test.argument, precede)
    )
      return false;
    const fresh = expectedFactoryCall(
      project,
      module,
      onlyArrayItem(conditional.consequent),
      1,
      render.rootFactory,
    );
    return Boolean(fresh && match(module, fresh.arguments[0], added));
  };
  return freshBranch(before.argument, true) && freshBranch(after.argument, false)
    ? "addChild"
    : null;
};

const collectOwnedGraphComponents = (
  project: NamedViteSourceProject,
  projection: NamedViteOmittedBooleanProjection,
  state: RegistryTransition,
  registration: ModuleRegistration,
  render: RenderProjection,
): readonly BoundNode[] | null => {
  const assembler = projection.assembly.registrar;
  if (!isFunctionLike(assembler.node) || !isNodeOfType(assembler.node.body, "BlockStatement"))
    return null;
  const mainStatements = assembler.node.body.body;
  for (const statement of mainStatements.slice(0, -2)) {
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.declarations.length !== 1)
      return null;
    const declarator = statement.declarations[0]!;
    if (lexical(assembler.module, declarator.id) === state.storage) continue;
    if (!isNodeOfType(declarator.init, "ArrowFunctionExpression") || statement.kind !== "const")
      return null;
  }
  const components: BoundNode[] = [];
  const moduleIds = new Set<string>();
  const registerDto = (module: NamedViteSourceModule, call: EsTreeNode): boolean => {
    const dto = expectedFactoryCall(project, module, call, 2, registration.factory);
    const component = dto && matchValue(project, module, dto.arguments[1]);
    const identifier = dto && literalName(project, module, dto.arguments[0]);
    if (!component || !isFunctionLike(component.node) || !identifier || moduleIds.has(identifier))
      return false;
    moduleIds.add(identifier);
    components.push(component);
    return true;
  };
  if (!registerDto(render.rootModuleValue.module, render.rootModuleValue.node)) return null;
  const scoped = projection.owner.module;
  const addInitialNode = (input: EsTreeNode): boolean => {
    const count = asCall(input, 2) ? 2 : 1;
    const call = expectedFactoryCall(project, scoped, input, count, render.rootFactory);
    if (!call) return false;
    const selected = matchValue(project, scoped, call.arguments[0]);
    if (
      !selected ||
      !registerDto(selected.module, selected.node) ||
      !onlyValueUses(project, selected, (use) => use === call.arguments[0])
    )
      return false;
    if (count === 1) return true;
    const children = call.arguments[1];
    return (
      isNodeOfType(children, "ArrayExpression") &&
      children.elements.every((child) => child && addInitialNode(child))
    );
  };
  const initial = projection.assemblyCall.arguments[0];
  if (
    !isNodeOfType(initial, "ArrayExpression") ||
    !initial.elements.every((child) => child && addInitialNode(child))
  )
    return null;

  for (const plugin of projection.plugins) {
    const { module, node } = plugin;
    if (
      !isFunctionLike(node) ||
      !isNodeOfType(node.body, "BlockStatement") ||
      !isNodeOfType(node.params[0], "ObjectPattern")
    )
      return null;
    const bindings = new Map<SymbolDescriptor, RegistryOperation | "augmentation">();
    for (const property of node.params[0].properties) {
      if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier"))
        return null;
      const key = getStaticPropertyKeyName(property);
      const bound = lexical(module, property.value);
      if (!key || !bound) return null;
      if (key === projection.assembly.key) {
        bindings.set(bound, "augmentation");
        continue;
      }
      const supplied = ownProperty(projection.assembly.injected, key)?.value;
      const handler = supplied && matchValue(project, assembler.module, supplied);
      const op = handler && readOperation(project, handler, state, registration, render);
      if (!op) return null;
      bindings.set(bound, op);
    }
    const acceptContains = (expression: EsTreeNode | null | undefined) => {
      const call = asCall(expression, 1);
      const symbol = call && callableLeaf(plugin, call.callee);
      return Boolean(
        call &&
        symbol &&
        bindings.get(symbol) === "contains" &&
        literalName(project, module, call.arguments[0]),
      );
    };
    const localDtoUses = new Map<SymbolDescriptor, Map<EsTreeNode, EsTreeNode>>();
    const acceptOperationArgument = (expression: EsTreeNode): boolean => {
      if (literalName(project, module, expression)) return true;
      return (
        isNodeOfType(expression, "ConditionalExpression") &&
        acceptContains(expression.test) &&
        Boolean(
          literalName(project, module, expression.consequent) &&
          literalName(project, module, expression.alternate),
        )
      );
    };
    const acceptBody = (statement: EsTreeNode, branch: EsTreeNode | null = null): boolean => {
      if (isNodeOfType(statement, "BlockStatement"))
        return Boolean(branch && statement.body.every((child) => acceptBody(child, branch)));
      if (isNodeOfType(statement, "IfStatement"))
        return (
          !branch &&
          acceptContains(statement.test) &&
          acceptBody(statement.consequent, statement.consequent) &&
          Boolean(statement.alternate && acceptBody(statement.alternate, statement.alternate))
        );
      if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const" && !branch) {
        const only = one(statement.declarations);
        const known = only && asIdentifier(only.id);
        const local = known && lexical(module, known);
        if (!local || !only?.init || !registerDto(module, only.init)) return false;
        localDtoUses.set(local, new Map());
        return true;
      }
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      const call = asCall(statement.expression, 1) ?? asCall(statement.expression, 2);
      const declarator = call && callableLeaf(plugin, call.callee);
      const operation = declarator && bindings.get(declarator);
      if (!call || !operation) return false;
      if (operation === "augmentation")
        return (
          !branch &&
          call.arguments.length === 1 &&
          isNodeOfType(call.arguments[0], "ArrowFunctionExpression")
        );
      if (operation === "contains" || call.arguments.length !== (operation === "addModule" ? 1 : 2))
        return false;
      if (operation !== "addModule" && !acceptOperationArgument(call.arguments[0])) return false;
      const dto = call.arguments.at(-1)!;
      const alias = isNodeOfType(dto, "Identifier") ? lexical(module, dto) : null;
      const localUses = alias && localDtoUses.get(alias);
      if (localUses) {
        if (!branch || localUses.has(branch)) return false;
        localUses.set(branch, dto);
        return true;
      }
      return registerDto(module, dto);
    };
    if (!node.body.body.every((statement) => acceptBody(statement))) return null;
    for (const [symbol, recognized] of localDtoUses) {
      const actual = bindingUses(symbol);
      const branches = [...recognized.keys()];
      if (
        branches.length !== 2 ||
        branches[0]?.parent !== branches[1]?.parent ||
        actual.length !== 2 ||
        !actual.every((use) => [...recognized.values()].includes(use))
      )
        return null;
    }
  }
  return components;
};

// The source projection selects one registration and verifies the exact
// recursive props forwarding path. The separate lifetime check must certify
// borrows of the nested record before this may qualify a warning.
export const readRegisteredBooleanForwarding = (
  project: NamedViteSourceProject,
  projection: NamedViteOmittedBooleanProjection,
  target: ConsumerTarget,
): RegisteredBooleanForwarding | null => {
  if (
    project.modulesByFilePath.get(projection.entry.filePath) !== projection.entry ||
    projection.selectedValue !== false
  )
    return null;
  const selected = selectedEffectConsumer(project, target);
  const registered = selected && findRegistration(project, projection, selected);
  const rendered = registered && renderForwarding(project, projection, registered);
  const state =
    registered && rendered && validateInsertion(project, projection, registered, rendered);
  const components =
    state &&
    registered &&
    rendered &&
    collectOwnedGraphComponents(project, projection, state, registered, rendered);
  if (!selected || !registered || !rendered || !components) return null;
  return { selected, registered, ...rendered, graphComponents: components };
};

export { isStockCall, verifyCarrierSpread };
