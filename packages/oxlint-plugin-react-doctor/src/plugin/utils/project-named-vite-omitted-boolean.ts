import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStableLexicalBindingValue } from "./get-stable-lexical-binding-value.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveVerifiedViteExport } from "./resolve-verified-vite-export.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

type ObjectNode = EsTreeNodeOfType<"ObjectExpression">;
type RecordPattern = EsTreeNodeOfType<"ObjectPattern">;
type FunctionNode = NonNullable<Parameters<typeof isFunctionLike>[0]> &
  EsTreeNodeOfType<"FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression">;
interface BoundNode {
  readonly module: NamedViteSourceModule;
  readonly node: EsTreeNode;
}
interface AugmentationAssembly {
  readonly key: string;
  readonly registrar: BoundNode;
  readonly injected: ObjectNode;
  readonly output: ObjectNode;
}
export interface NamedViteOmittedLiteralProjection<Value extends false | null> {
  readonly entry: NamedViteSourceModule;
  readonly caller: BoundNode;
  readonly owner: BoundNode;
  readonly defaults: BoundNode;
  readonly ownDataKeys: ReadonlySet<string>;
  readonly plugins: readonly BoundNode[];
  readonly assembly: AugmentationAssembly;
  readonly assemblyCall: EsTreeNodeOfType<"CallExpression">;
  readonly assembledBinding: SymbolDescriptor;
  readonly selectedValue: Value;
}

export type NamedViteOmittedBooleanProjection = NamedViteOmittedLiteralProjection<false>;

const only = <T>(values: readonly T[]): T | undefined =>
  values.length === 1 ? values[0] : undefined;
const same = (
  module: NamedViteSourceModule,
  node: EsTreeNode | null | undefined,
  binding: SymbolDescriptor | null | undefined,
): boolean => Boolean(node && binding && module.scopes.symbolFor(node) === binding);
const sameValue = (a: BoundNode | null, b: BoundNode | null): boolean =>
  Boolean(a && b && a.module === b.module && a.node === b.node);
const asObject = (node: EsTreeNode | null | undefined): ObjectNode | null => {
  const value = node && stripParenExpression(node);
  return isNodeOfType(value, "ObjectExpression") ? value : null;
};
const hasUniquePlainFields = (node: ObjectNode | RecordPattern, permitRest: boolean): boolean => {
  const keys = new Set<string>();
  return node.properties.every((property) => {
    if (isNodeOfType(property, "RestElement") || isNodeOfType(property, "SpreadElement"))
      return permitRest;
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return false;
    const key = getStaticPropertyKeyName(property);
    if (
      !key ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype" ||
      keys.has(key)
    )
      return false;
    keys.add(key);
    return true;
  });
};
const ownProperty = (
  node: ObjectNode | RecordPattern,
  key: string,
): EsTreeNodeOfType<"Property"> | null => {
  const property = only(
    node.properties.filter(
      (item) => isNodeOfType(item, "Property") && getStaticPropertyKeyName(item) === key,
    ),
  );
  return isNodeOfType(property, "Property") ? property : null;
};
const patternRest = (pattern: RecordPattern): EsTreeNodeOfType<"Identifier"> | null => {
  const last = pattern.properties.at(-1);
  return isNodeOfType(last, "RestElement") && isNodeOfType(last.argument, "Identifier")
    ? last.argument
    : null;
};
const bindingUses = (symbol: SymbolDescriptor): EsTreeNode[] =>
  symbol.references.flatMap(({ identifier }) => {
    const property = identifier.parent;
    if (
      isNodeOfType(property, "Property") &&
      property.shorthand &&
      !property.computed &&
      property.value !== identifier &&
      property.key === identifier
    )
      return [];
    return [identifier];
  });
const onlyUsedAt = (symbol: SymbolDescriptor | null, node: EsTreeNode | null): boolean =>
  Boolean(symbol && node && only(bindingUses(symbol)) === node);
const lexical = (module: NamedViteSourceModule, node: EsTreeNode): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "JSXIdentifier")) return module.scopes.symbolFor(node);
  for (let scope = module.scopes.scopeFor(node); scope; ) {
    const symbol = scope.symbolsByName.get(node.name);
    if (symbol) return symbol;
    if (!scope.parent) return null;
    scope = scope.parent;
  }
  return null;
};
const selectValue = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  binding: SymbolDescriptor | null,
): BoundNode | null => {
  if (!binding || binding.references.some((reference) => reference.flag !== "read")) return null;
  if (binding.kind === "import") {
    const imported = resolveImportedApiReference(binding.bindingIdentifier, module.scopes);
    const selected =
      imported?.importedName && !imported.isNamespace
        ? resolveVerifiedViteExport(project, module, imported.source, imported.importedName)
        : null;
    return selected ? { module: selected.module, node: selected.exportedNode } : null;
  }
  const value = getStableLexicalBindingValue(binding, module.scopes);
  return value ? { module, node: value } : null;
};
const matchValue = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  input: EsTreeNode,
): BoundNode | null => selectValue(project, module, lexical(module, input));
const noLocalNamespaceImports = (module: NamedViteSourceModule) =>
  module.programNode.body.every(
    (statement) =>
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      typeof statement.source.value !== "string" ||
      !module.localImports.has(statement.source.value) ||
      !statement.specifiers.some((specifier) =>
        isNodeOfType(specifier, "ImportNamespaceSpecifier"),
      ),
  );

const onlyValueUses = (
  project: NamedViteSourceProject,
  target: BoundNode,
  accepts: (node: EsTreeNode) => boolean,
): boolean => {
  const cache = new Map<SymbolDescriptor, BoundNode | null>();
  for (const module of project.modulesByFilePath.values()) {
    if (!noLocalNamespaceImports(module)) return false;
    let valid = true;
    walkAst(module.programNode, (node) => {
      if (!valid) return false;
      if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) return;
      const symbol = lexical(module, node);
      if (!symbol || node === symbol.bindingIdentifier) return;
      const parent = node.parent;
      if (
        isNodeOfType(parent, "ImportSpecifier") ||
        isNodeOfType(parent, "ImportDefaultSpecifier") ||
        isNodeOfType(parent, "ExportSpecifier") ||
        isNodeOfType(parent, "ExportDefaultDeclaration")
      )
        return;
      if (!cache.has(symbol)) cache.set(symbol, selectValue(project, module, symbol));
      // A write was declined by selectValue, but still refers to the same candidate's initializer.
      const selected =
        cache.get(symbol) ??
        (symbol.kind === "const" && symbol.initializer
          ? { module, node: stripParenExpression(symbol.initializer) }
          : null);
      if (sameValue(selected, target) && !accepts(node)) valid = false;
    });
    if (!valid) return false;
  }
  return true;
};

const readNamedEntryApp = (
  project: NamedViteSourceProject,
  entry: NamedViteSourceModule,
): BoundNode | null => {
  const rendered: EsTreeNodeOfType<"JSXElement">[] = [];
  for (const statement of entry.programNode.body) {
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    const call = statement.expression;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      !isNodeOfType(call.callee, "MemberExpression") ||
      call.callee.optional ||
      getStaticPropertyName(call.callee) !== "render" ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.arguments[0], "JSXElement") ||
      !isNodeOfType(call.callee.object, "CallExpression")
    )
      continue;
    const imported = resolveImportedApiReference(call.callee.object.callee, entry.scopes);
    if (imported?.source === "react-dom/client" && imported.importedName === "createRoot")
      rendered.push(call.arguments[0]);
  }
  let element = only(rendered);
  if (element && isNodeOfType(element.openingElement.name, "JSXMemberExpression")) {
    const { object, property } = element.openingElement.name;
    if (
      !isNodeOfType(object, "JSXIdentifier") ||
      property.name !== "StrictMode" ||
      element.openingElement.attributes.length
    )
      return null;
    const importedSymbol = lexical(entry, object);
    const react =
      importedSymbol && resolveImportedApiReference(importedSymbol.bindingIdentifier, entry.scopes);
    if (react?.source !== "react" || !react.isNamespace) return null;
    const child = only(
      element.children.filter(
        (value) => !isNodeOfType(value, "JSXText") || value.value.trim() !== "",
      ),
    );
    if (!isNodeOfType(child, "JSXElement")) return null;
    element = child;
  }
  if (
    !element ||
    element.openingElement.attributes.length ||
    element.children.length ||
    !isNodeOfType(element.openingElement.name, "JSXIdentifier")
  )
    return null;
  return matchValue(project, entry, element.openingElement.name);
};

const unconditionalReturn = (fn: FunctionNode): EsTreeNode | null => {
  if (!isNodeOfType(fn.body, "BlockStatement")) return stripParenExpression(fn.body);
  const tail = fn.body.body.at(-1);
  if (!isNodeOfType(tail, "ReturnStatement")) return null;
  let returns = 0;
  walkAst(fn.body, (node) => {
    if (isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement")) returns++;
  });
  return returns === 1 && tail.argument ? stripParenExpression(tail.argument) : null;
};
const defaultEmptyArray = (node: EsTreeNode | undefined) =>
  isNodeOfType(node, "AssignmentPattern") &&
  isNodeOfType(node.left, "Identifier") &&
  isNodeOfType(node.right, "ArrayExpression") &&
  node.right.elements.length === 0
    ? node.left
    : null;
const getMemberCall = (node: EsTreeNode | null | undefined, key: string) =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  getStaticPropertyName(node.callee) === key
    ? { call: node, receiver: node.callee.object }
    : null;
const singleEffectExpression = (fn: EsTreeNodeOfType<"ArrowFunctionExpression">) => {
  if (!isNodeOfType(fn.body, "BlockStatement")) return fn.body;
  const statement = only(fn.body.body);
  return isNodeOfType(statement, "ExpressionStatement") ? statement.expression : null;
};
const hasImplicitArguments = (fn: FunctionNode): boolean => {
  let found = false;
  walkAst(fn, (node) => {
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") && node.name === "arguments")
    )
      found = true;
    return !found;
  });
  return found;
};

const readRegistration = (target: BoundNode, replayKey: string): AugmentationAssembly | null => {
  const { module, node } = target;
  if (
    !isFunctionLike(node) ||
    node.async ||
    node.generator ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.params.length !== 3 ||
    hasImplicitArguments(node)
  )
    return null;
  const pluginParameter = defaultEmptyArray(node.params[1]);
  const arrayParameter = defaultEmptyArray(node.params[2]);
  const pluginBinding = pluginParameter && lexical(module, pluginParameter);
  const arrayBinding = arrayParameter && lexical(module, arrayParameter);
  if (!pluginBinding || !arrayBinding) return null;
  const output = asObject(unconditionalReturn(node));
  if (!output || !hasUniquePlainFields(output, false)) return null;
  const replay = ownProperty(output, replayKey)?.value;
  if (
    !isNodeOfType(replay, "ArrowFunctionExpression") ||
    replay.async ||
    replay.params.length !== 1 ||
    !isNodeOfType(replay.params[0], "Identifier")
  )
    return null;
  const reduce = getMemberCall(getSingleReturnExpression(replay), "reduce");
  if (
    !reduce ||
    !same(module, reduce.receiver, arrayBinding) ||
    reduce.call.arguments.length !== 2 ||
    !same(module, reduce.call.arguments[1], lexical(module, replay.params[0]))
  )
    return null;
  const apply = reduce.call.arguments[0];
  if (
    !isNodeOfType(apply, "ArrowFunctionExpression") ||
    apply.async ||
    apply.params.length !== 2 ||
    !isNodeOfType(apply.params[0], "Identifier") ||
    !isNodeOfType(apply.params[1], "Identifier")
  )
    return null;
  const applyCall = getSingleReturnExpression(apply);
  if (
    !isNodeOfType(applyCall, "CallExpression") ||
    applyCall.optional ||
    applyCall.arguments.length !== 1 ||
    !same(module, applyCall.callee, lexical(module, apply.params[1])) ||
    !same(module, applyCall.arguments[0], lexical(module, apply.params[0]))
  )
    return null;
  const arrayUses = bindingUses(arrayBinding);
  const onePushUse = only(arrayUses.filter((use) => use !== reduce.receiver));
  const push = getMemberCall(onePushUse?.parent?.parent, "push");
  if (
    arrayUses.length !== 2 ||
    !push ||
    push.receiver !== onePushUse ||
    push.call.arguments.length !== 1
  )
    return null;
  const location = push.call.parent;
  const pushFunction = isNodeOfType(location, "BlockStatement")
    ? location.parent
    : location?.parent?.parent;
  if (
    !isNodeOfType(pushFunction, "ArrowFunctionExpression") ||
    pushFunction.async ||
    pushFunction.params.length !== 1 ||
    !isNodeOfType(pushFunction.params[0], "Identifier") ||
    singleEffectExpression(pushFunction) !== push.call ||
    !same(module, push.call.arguments[0], lexical(module, pushFunction.params[0]))
  )
    return null;
  const registration = pushFunction.parent;
  if (
    !isNodeOfType(registration, "VariableDeclarator") ||
    !isNodeOfType(registration.id, "Identifier") ||
    !isNodeOfType(registration.parent, "VariableDeclaration") ||
    registration.parent.kind !== "const" ||
    registration.parent.parent !== node.body
  )
    return null;
  const registrationBinding = lexical(module, registration.id);
  const pluginUse = only(bindingUses(pluginBinding));
  const iterate = getMemberCall(pluginUse?.parent?.parent, "forEach");
  if (
    !registrationBinding ||
    !iterate ||
    iterate.receiver !== pluginUse ||
    iterate.call.arguments.length !== 1 ||
    iterate.call.parent?.parent !== node.body
  )
    return null;
  const visitor = iterate.call.arguments[0];
  if (
    !isNodeOfType(visitor, "ArrowFunctionExpression") ||
    visitor.async ||
    visitor.params.length !== 1 ||
    !isNodeOfType(visitor.params[0], "Identifier")
  )
    return null;
  const invoke = singleEffectExpression(visitor);
  if (
    !isNodeOfType(invoke, "CallExpression") ||
    invoke.optional ||
    invoke.arguments.length !== 1 ||
    !same(module, invoke.callee, lexical(module, visitor.params[0]))
  )
    return null;
  const injected = asObject(invoke.arguments[0]);
  const registrationUse = only(bindingUses(registrationBinding));
  const property = registrationUse?.parent;
  if (
    !injected ||
    !hasUniquePlainFields(injected, false) ||
    !isNodeOfType(property, "Property") ||
    property.parent !== injected ||
    property.value !== registrationUse
  )
    return null;
  const key = getStaticPropertyKeyName(property);
  return key ? { key, registrar: target, injected, output } : null;
};

const preservesSelectedField = (
  plugin: BoundNode,
  key: string,
  field: string,
  member: string,
  allowShallowOverride: boolean,
): boolean => {
  const { module, node } = plugin;
  if (
    !isFunctionLike(node) ||
    node.async ||
    node.generator ||
    !isNodeOfType(node.body, "BlockStatement") ||
    node.params.length !== 1 ||
    !isNodeOfType(node.params[0], "ObjectPattern") ||
    !hasUniquePlainFields(node.params[0], false) ||
    hasImplicitArguments(node)
  )
    return false;
  const register = ownProperty(node.params[0], key)?.value;
  const binding = isNodeOfType(register, "Identifier") && lexical(module, register);
  const use = binding && only(bindingUses(binding));
  const call = use && use.parent;
  if (
    !call ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.callee !== use ||
    call.arguments.length !== 1 ||
    call.parent?.parent !== node.body
  )
    return false;
  const callback = call.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "ObjectPattern") ||
    !hasUniquePlainFields(callback.params[0], true)
  )
    return false;
  const rest = patternRest(callback.params[0]);
  const output = asObject(unconditionalReturn(callback));
  if (!rest || !output || !hasUniquePlainFields(output, true)) return false;
  const source = ownProperty(callback.params[0], field)?.value;
  const outputRecord = ownProperty(output, field)?.value;
  if (source || outputRecord) {
    if (!allowShallowOverride || !isNodeOfType(source, "Identifier")) return false;
    const replacement = asObject(outputRecord);
    const first = replacement?.properties[0];
    if (
      !replacement ||
      !hasUniquePlainFields(replacement, true) ||
      ownProperty(replacement, member) ||
      !isNodeOfType(first, "SpreadElement") ||
      replacement.properties.filter((property) => isNodeOfType(property, "SpreadElement"))
        .length !== 1 ||
      !onlyUsedAt(lexical(module, source), first.argument)
    )
      return false;
  }
  const fields = output.properties.filter((property) => isNodeOfType(property, "SpreadElement"));
  const spread = only(fields);
  return Boolean(
    spread &&
    spread === output.properties.at(-1) &&
    onlyUsedAt(lexical(module, rest), spread.argument),
  );
};

const absenceSafeDefaultUse = (
  node: EsTreeNode,
  initializer: EsTreeNode,
  field: string,
): boolean => {
  if (node === initializer) return true;
  let value = node.parent;
  if (!isNodeOfType(value, "MemberExpression") || value.object !== node || value.optional)
    return false;
  const key = getStaticPropertyName(value);
  if (!key || key === field || ["__proto__", "constructor", "prototype"].includes(key))
    return false;
  while (isNodeOfType(value.parent, "MemberExpression") && value.parent.object === value)
    value = value.parent;
  const use = value.parent;
  return (
    !isWithinAssignmentTarget(value) &&
    !isNodeOfType(use, "CallExpression") &&
    !isNodeOfType(use, "NewExpression") &&
    !isNodeOfType(use, "TaggedTemplateExpression")
  );
};

const matchCallerOwner = <Value extends false | null>(
  project: NamedViteSourceProject,
  entry: NamedViteSourceModule,
  caller: BoundNode,
  element: EsTreeNodeOfType<"JSXElement">,
  recordField: string,
  booleanField: string,
  expected: Value,
): NamedViteOmittedLiteralProjection<Value> | null => {
  const tag = element.openingElement.name;
  if (
    !isNodeOfType(tag, "JSXIdentifier") ||
    element.children.length ||
    element.openingElement.attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        [recordField, "__proto__", "constructor", "prototype"].includes(attribute.name.name),
    )
  )
    return null;
  const owner = matchValue(project, caller.module, tag);
  if (
    !owner ||
    !isFunctionLike(owner.node) ||
    owner.node.async ||
    owner.node.generator ||
    !isNodeOfType(owner.node.body, "BlockStatement") ||
    owner.node.params.length !== 1 ||
    !isNodeOfType(owner.node.params[0], "ObjectPattern")
  )
    return null;
  if (
    !onlyValueUses(project, owner, (node) => node === tag || node === element.closingElement?.name)
  )
    return null;
  const module = owner.module;
  const rootPattern = owner.node.params[0];
  const rootRecord = ownProperty(rootPattern, recordField)?.value;
  const hostRest = patternRest(rootPattern);
  if (
    !hasUniquePlainFields(rootPattern, true) ||
    !isNodeOfType(rootRecord, "Identifier") ||
    !hostRest
  )
    return null;

  const statements = owner.node.body.body;
  const constDeclarations = statements.flatMap((statement) =>
    isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const"
      ? statement.declarations
      : [],
  );
  const declaration = only(
    constDeclarations.filter(
      (candidate) =>
        isNodeOfType(candidate.id, "ObjectPattern") && ownProperty(candidate.id, recordField),
    ),
  );
  if (
    !declaration ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !hasUniquePlainFields(declaration.id, true) ||
    !isNodeOfType(declaration.init, "Identifier")
  )
    return null;
  const defaultBinding = ownProperty(declaration.id, recordField)?.value;
  const defaultRest = patternRest(declaration.id);
  const defaults = matchValue(project, module, declaration.init);
  if (
    !isNodeOfType(defaultBinding, "Identifier") ||
    !defaultRest ||
    !defaults ||
    !isNodeOfType(defaults.node, "ObjectExpression") ||
    !hasUniquePlainFields(defaults.node, false)
  )
    return null;
  const record = asObject(ownProperty(defaults.node, recordField)?.value);
  const boolean = record && ownProperty(record, booleanField)?.value;
  if (
    !record ||
    !hasUniquePlainFields(record, false) ||
    !isNodeOfType(boolean, "Literal") ||
    boolean.value !== expected ||
    !onlyValueUses(project, defaults, (node) =>
      absenceSafeDefaultUse(node, declaration.init!, recordField),
    )
  )
    return null;

  const merged = only(
    constDeclarations.filter(
      (candidate) =>
        isNodeOfType(candidate.init, "CallExpression") &&
        candidate.init.arguments.length === 1 &&
        Boolean(
          asObject(candidate.init.arguments[0])?.properties.some(
            (property) =>
              isNodeOfType(property, "Property") &&
              getStaticPropertyKeyName(property) === recordField,
          ),
        ),
    ),
  );
  if (
    !merged ||
    !isNodeOfType(merged.id, "Identifier") ||
    !isNodeOfType(merged.init, "CallExpression") ||
    merged.init.optional ||
    !isNodeOfType(merged.init.callee, "Identifier")
  )
    return null;
  const input = asObject(merged.init.arguments[0]);
  const mergedRecord = input && asObject(ownProperty(input, recordField)?.value);
  if (
    !input ||
    !hasUniquePlainFields(input, true) ||
    !mergedRecord ||
    mergedRecord.properties.length !== 2
  )
    return null;
  const [first, second] = mergedRecord.properties;
  const [firstRest, secondRest] = input.properties.slice(-2);
  if (
    input.properties.filter((property) => isNodeOfType(property, "SpreadElement")).length !== 2 ||
    !isNodeOfType(first, "SpreadElement") ||
    !isNodeOfType(second, "SpreadElement") ||
    !isNodeOfType(firstRest, "SpreadElement") ||
    !isNodeOfType(secondRest, "SpreadElement") ||
    !onlyUsedAt(lexical(module, defaultBinding), first.argument) ||
    !onlyUsedAt(lexical(module, rootRecord), second.argument) ||
    !onlyUsedAt(lexical(module, defaultRest), firstRest.argument) ||
    !onlyUsedAt(lexical(module, hostRest), secondRest.argument)
  )
    return null;
  const assembledBinding = lexical(module, merged.id);
  const replay = lexical(module, merged.init.callee);
  const declarationNode = replay?.declarationNode;
  if (
    !assembledBinding ||
    !replay ||
    !isNodeOfType(declarationNode, "VariableDeclarator") ||
    !constDeclarations.some((item) => (item as EsTreeNode) === declarationNode) ||
    !onlyUsedAt(replay, merged.init.callee) ||
    !isNodeOfType(declarationNode.id, "ObjectPattern") ||
    !hasUniquePlainFields(declarationNode.id, false)
  )
    return null;
  const replayProperty = declarationNode.id.properties.find(
    (property) => isNodeOfType(property, "Property") && property.value === replay.bindingIdentifier,
  );
  const replayKey = replayProperty && getStaticPropertyKeyName(replayProperty);
  const assemblyCall = declarationNode.init;
  if (
    !replayKey ||
    !isNodeOfType(assemblyCall, "CallExpression") ||
    assemblyCall.optional ||
    assemblyCall.arguments.length !== 2 ||
    !isNodeOfType(assemblyCall.callee, "Identifier")
  )
    return null;
  const registrar = matchValue(project, module, assemblyCall.callee);
  const assembly = registrar && readRegistration(registrar, replayKey);
  const selected = assemblyCall.arguments[1];
  if (
    !assembly ||
    !isNodeOfType(selected, "LogicalExpression") ||
    selected.operator !== "||" ||
    !isNodeOfType(selected.left, "Identifier") ||
    !isNodeOfType(selected.right, "Identifier")
  )
    return null;
  const hostProperty = rootPattern.properties.find(
    (property) =>
      isNodeOfType(property, "Property") &&
      isNodeOfType(property.value, "Identifier") &&
      same(module, selected.left, lexical(module, property.value)),
  );
  const listKey = hostProperty && getStaticPropertyKeyName(hostProperty);
  const defaultList = listKey ? ownProperty(declaration.id, listKey)?.value : null;
  if (
    !listKey ||
    !isNodeOfType(defaultList, "Identifier") ||
    !same(module, selected.right, lexical(module, defaultList)) ||
    !onlyUsedAt(lexical(module, selected.left), selected.left) ||
    !onlyUsedAt(lexical(module, selected.right), selected.right)
  )
    return null;
  const attribute = only(
    element.openingElement.attributes.filter(
      (item) =>
        isNodeOfType(item, "JSXAttribute") &&
        isNodeOfType(item.name, "JSXIdentifier") &&
        item.name.name === listKey,
    ),
  );
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "ArrayExpression")
  )
    return null;
  const selectedPlugins = attribute.value.expression.elements;
  if (!selectedPlugins.length || selectedPlugins.length > 24) return null;
  const plugins: BoundNode[] = [];
  for (const value of selectedPlugins) {
    if (!isNodeOfType(value, "Identifier")) return null;
    const plugin = matchValue(project, caller.module, value);
    if (
      !plugin ||
      !preservesSelectedField(plugin, assembly.key, recordField, booleanField, expected === null)
    )
      return null;
    plugins.push(plugin);
  }
  const ownDataKeys = new Set(
    record.properties.flatMap((property) => {
      const key = getStaticPropertyKeyName(property);
      return key ? [key] : [];
    }),
  );
  return {
    entry,
    caller,
    owner,
    defaults,
    ownDataKeys,
    plugins,
    assembly,
    assemblyCall,
    assembledBinding,
    selectedValue: expected,
  };
};

// The compiler verifies which entry and local import edges the named stock
// build selects. This stage ends at the assembled own record, before a component
// receives or publishes the record. It cannot justify suppressing a warning alone.
// The named build's caller must also establish stock object and array semantics.
const projectNamedViteOmittedLiteral = <Value extends false | null>(
  project: NamedViteSourceProject,
  [recordField, booleanField]: readonly [string, string],
  expected: Value,
): NamedViteOmittedLiteralProjection<Value> | null => {
  const entry = project.modulesByFilePath.get(project.entry);
  if (!entry) return null;
  const caller = readNamedEntryApp(project, entry);
  if (!caller || !isFunctionLike(caller.node) || caller.node.async || caller.node.generator)
    return null;
  const returned = unconditionalReturn(caller.node);
  if (!isNodeOfType(returned, "JSXElement") && !isNodeOfType(returned, "JSXFragment")) return null;
  const candidates: NamedViteOmittedLiteralProjection<Value>[] = [];
  const visit = (node: EsTreeNode) => {
    if (isNodeOfType(node, "JSXFragment")) {
      node.children.forEach(visit);
      return;
    }
    if (
      !isNodeOfType(node, "JSXElement") ||
      !isNodeOfType(node.openingElement.name, "JSXIdentifier")
    )
      return;
    const match = matchCallerOwner(
      project,
      entry,
      caller,
      node,
      recordField,
      booleanField,
      expected,
    );
    if (match) candidates.push(match);
    if (/^[a-z]/u.test(node.openingElement.name.name)) node.children.forEach(visit);
  };
  visit(returned);
  return only(candidates) ?? null;
};

export const projectNamedViteOmittedBoolean = (
  project: NamedViteSourceProject,
  fields: readonly [string, string],
) => projectNamedViteOmittedLiteral(project, fields, false);
export const projectNamedViteOmittedNull = (
  project: NamedViteSourceProject,
  fields: readonly [string, string],
) => projectNamedViteOmittedLiteral(project, fields, null);

export type { BoundNode };
export {
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
  unconditionalReturn,
};
