import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getExecutableValueReferences as valueReferences } from "./get-executable-value-references.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { walkAst } from "./walk-ast.js";

interface HookAttachmentModule {
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

interface HookAttachmentInput {
  readonly hookModule: HookAttachmentModule;
  readonly hook: EsTreeNode;
  readonly receiver: EsTreeNode;
  readonly callerModule: HookAttachmentModule;
  readonly hookSource: string;
  readonly hookExport: string;
  readonly childSource: string;
  readonly childExport: string;
  readonly observerField: string;
}

interface HookAttachmentPath {
  readonly hookRef: SymbolDescriptor;
  readonly refField: string;
  readonly receivingChild: EsTreeNodeOfType<"JSXOpeningElement">;
  readonly receivingProp: string;
  readonly initializationSites: readonly EsTreeNodeOfType<"CallExpression">[];
  readonly observerSlots: readonly EsTreeNodeOfType<"MemberExpression">[];
}

const isReactImport = (value: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  const resolved = resolveImportedApiReference(value, scopes);
  return resolved?.source === "react" && resolved.importedName === name;
};

const hasClosedSymbol = (
  symbol: SymbolDescriptor | null,
  mod: HookAttachmentModule,
): symbol is SymbolDescriptor =>
  Boolean(
    symbol &&
    hasCompleteSymbolReferences(symbol, mod.program, mod.scopes) &&
    valueReferences(symbol).every(({ flag }) => flag === "read"),
  );

const directMember = (
  reference: EsTreeNode,
  name: string,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const root = findTransparentExpressionRoot(reference);
  const member = root.parent;
  return isNodeOfType(member, "MemberExpression") &&
    member.object === root &&
    !member.computed &&
    getStaticPropertyName(member) === name
    ? member
    : null;
};

const isNullRef = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const initializer = getDirectConstInitializer(symbol);
  return (
    isNodeOfType(initializer, "CallExpression") &&
    !initializer.optional &&
    initializer.arguments.length === 1 &&
    isReactImport(initializer.callee, "useRef", scopes) &&
    isNodeOfType(initializer.arguments[0], "Literal") &&
    initializer.arguments[0].value === null
  );
};

const propertyMap = (object: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(object, "ObjectExpression") && !isNodeOfType(object, "ObjectPattern"))
    return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of object.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (key === null || key === "__proto__" || fields.has(key)) return null;
    fields.set(key, property.value);
  }
  return fields;
};

const isFalsyGuardRead = (member: EsTreeNode): boolean => {
  const value = findTransparentExpressionRoot(member);
  const parent = value.parent;
  const condition = parent?.parent;
  return (
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "!" &&
      parent.argument === value) ||
    (isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      isNodeOfType(condition, "IfStatement") &&
      condition.test === parent)
  );
};

const readDirectInvocation = (
  expectedCallee: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const call = expectedCallee.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === expectedCallee ? call : null;
};

const readHookReturn = (hook: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isFunctionLike(hook) || !isNodeOfType(hook.body, "BlockStatement")) return null;
  const last = hook.body.body.at(-1);
  if (!isNodeOfType(last, "ReturnStatement") || !last.argument) return null;
  let otherReturn = false;
  walkAst(hook.body, (node) => {
    if (isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node !== last) otherReturn = true;
  });
  return otherReturn ? null : propertyMap(last.argument);
};

const readObserverParameterSlot = (
  value: EsTreeNode,
  mod: HookAttachmentModule,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const symbol = mod.scopes.symbolFor(value);
  if (!hasClosedSymbol(symbol, mod) || valueReferences(symbol).length !== 1) return null;
  const memo = getDirectConstInitializer(symbol);
  if (
    !isNodeOfType(memo, "CallExpression") ||
    memo.optional ||
    !isReactImport(memo.callee, "useCallback", mod.scopes)
  )
    return null;
  const callback = memo.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier")
  )
    return null;
  const arg = mod.scopes.symbolFor(callback.params[0]);
  if (!hasClosedSymbol(arg, mod)) return null;
  let observerSlot: EsTreeNodeOfType<"MemberExpression"> | null = null;
  for (const { identifier } of valueReferences(arg)) {
    const read = directMember(identifier, "current");
    if (!read || isWithinAssignmentTarget(read)) return null;
    if (isFalsyGuardRead(read)) continue;
    const call = read.parent;
    if (
      observerSlot ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== 1 ||
      call.arguments[0] !== read ||
      !isNodeOfType(call.callee, "MemberExpression") ||
      getStaticPropertyName(call.callee) !== "observe" ||
      !isNodeOfType(call.callee.object, "MemberExpression") ||
      getStaticPropertyName(call.callee.object) !== "current"
    )
      return null;
    observerSlot = call.callee.object;
  }
  return observerSlot;
};

const readHookResultUse = (
  mod: HookAttachmentModule,
  specifier: string,
  importedName: string,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let result: EsTreeNodeOfType<"VariableDeclarator"> | null = null;
  let invalid = false;
  walkAst(mod.program, (node) => {
    if (!isNodeOfType(node, "Identifier")) return;
    const binding = mod.scopes.symbolFor(node);
    if (binding?.kind !== "import" || node === binding.bindingIdentifier) return;
    const imported = resolveImportedApiReference(node, mod.scopes);
    if (imported?.source !== specifier || imported.importedName !== importedName) return;
    const call = readDirectInvocation(node);
    if (
      result ||
      !hasClosedSymbol(binding, mod) ||
      !call ||
      call.optional ||
      !isNodeOfType(call.parent, "VariableDeclarator") ||
      call.parent.init !== call ||
      !isNodeOfType(call.parent.parent, "VariableDeclaration") ||
      call.parent.parent.kind !== "const" ||
      !isNodeOfType(call.parent.id, "ObjectPattern")
    ) {
      invalid = true;
    } else {
      result = call.parent;
    }
  });
  return invalid ? null : result;
};

const readObserverMirrorSites = (
  original: SymbolDescriptor,
  ref: SymbolDescriptor,
  mod: HookAttachmentModule,
): EsTreeNodeOfType<"CallExpression">[] | null => {
  const reads = valueReferences(original);
  if (reads.length !== 1) return null;
  const rhs = reads[0].identifier;
  const write = rhs.parent;
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    write.right !== rhs ||
    !isNodeOfType(write.left, "MemberExpression") ||
    write.left.optional ||
    write.left.computed ||
    getStaticPropertyName(write.left) !== "current" ||
    !isNodeOfType(write.left.object, "Identifier")
  )
    return null;
  const mirror = mod.scopes.symbolFor(write.left.object);
  if (!hasClosedSymbol(mirror, mod) || !isNullRef(mirror, mod.scopes)) return null;
  const owner = findEnclosingFunction(original.bindingIdentifier);
  if (
    !owner ||
    !isFunctionLike(owner) ||
    findEnclosingFunction(write) !== owner ||
    findEnclosingFunction(mirror.bindingIdentifier) !== owner ||
    !isNodeOfType(write.parent, "ExpressionStatement") ||
    write.parent.parent !== owner.body
  )
    return null;
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const { identifier } of valueReferences(mirror)) {
    const member = directMember(identifier, "current");
    if (member === write.left) continue;
    const call = member && readDirectInvocation(member);
    if (
      !call ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.arguments[0], "Identifier") ||
      mod.scopes.symbolFor(call.arguments[0]) !== ref ||
      call.range[0] <= write.range[0]
    )
      return null;
    calls.push(call);
  }
  return calls.length ? calls : null;
};

const isDependencyRead = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const array = identifier.parent;
  if (
    !isNodeOfType(array, "ArrayExpression") ||
    !array.elements.some((element) => element === identifier)
  )
    return false;
  const hook = array.parent;
  return (
    isNodeOfType(hook, "CallExpression") &&
    !hook.optional &&
    hook.arguments[1] === array &&
    hook.arguments.length === 2 &&
    ["useEffect", "useLayoutEffect", "useCallback", "useMemo"].some((name) =>
      isReactImport(hook.callee, name, scopes),
    )
  );
};

const isRenderedInsideOwner = (opening: EsTreeNode, owner: EsTreeNode): boolean => {
  let value = opening.parent;
  if (!isNodeOfType(value, "JSXElement")) return false;
  while (value) {
    const wrapped = findTransparentExpressionRoot(value);
    const container = wrapped.parent;
    if (isNodeOfType(container, "ReturnStatement")) {
      return container.argument === wrapped && findEnclosingFunction(container) === owner;
    }
    if (isNodeOfType(container, "JSXElement")) {
      const ancestor = container.openingElement;
      if (
        !isNodeOfType(ancestor.name, "JSXIdentifier") ||
        !["div", "nav", "section", "main"].includes(ancestor.name.name) ||
        ancestor.attributes.some(
          (attribute) =>
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier") ||
            attribute.name.name === "is",
        ) ||
        !container.children.some((child) => child === wrapped)
      )
        return false;
    } else if (isNodeOfType(container, "JSXFragment")) {
      if (!container.children.some((child) => child === wrapped)) return false;
    } else if (isNodeOfType(container, "JSXExpressionContainer")) {
      if (container.expression !== wrapped) return false;
    } else if (isNodeOfType(container, "LogicalExpression")) {
      if (container.right !== wrapped) return false;
    } else if (isNodeOfType(container, "ConditionalExpression")) {
      if (container.test === wrapped) return false;
    } else {
      return false;
    }
    value = container;
  }
  return false;
};

export const readClosedHookRefAttachmentPath = (
  input: HookAttachmentInput,
): HookAttachmentPath | null => {
  const { hookModule, hook, receiver, callerModule } = input;
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.optional ||
    receiver.computed ||
    getStaticPropertyName(receiver) !== "current" ||
    !isNodeOfType(receiver.object, "Identifier")
  )
    return null;
  const ref = hookModule.scopes.symbolFor(receiver.object);
  if (
    !hasClosedSymbol(ref, hookModule) ||
    !isNullRef(ref, hookModule.scopes) ||
    findEnclosingFunction(ref.bindingIdentifier) !== hook
  )
    return null;
  const hookFields = readHookReturn(hook);
  if (!hookFields) return null;
  const returned = Array.from(hookFields).filter(
    ([, value]) => hookModule.scopes.symbolFor(value) === ref,
  );
  const [field, returnedReference] = returned[0] ?? [];
  if (!field || !returnedReference || returned.length !== 1) return null;
  const producer = hookFields.get(input.observerField);
  const observeSlot = producer && readObserverParameterSlot(producer, hookModule);
  if (!observeSlot) return null;
  const observerSymbol = hookModule.scopes.symbolFor(observeSlot.object);
  if (!hasClosedSymbol(observerSymbol, hookModule) || !isNullRef(observerSymbol, hookModule.scopes))
    return null;
  for (const { identifier } of valueReferences(ref)) {
    if (identifier === returnedReference) continue;
    const current = directMember(identifier, "current");
    if (!current || isWithinAssignmentTarget(current)) return null;
    if (isFalsyGuardRead(current)) continue;
    const measure = directMember(current, "getBoundingClientRect");
    const invocation = measure && readDirectInvocation(measure);
    if (invocation && !invocation.optional && invocation.arguments.length === 0) continue;
    const call = current.parent;
    if (
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.arguments.length === 1 &&
      call.arguments[0] === current &&
      isNodeOfType(call.callee, "MemberExpression") &&
      getStaticPropertyName(call.callee) === "unobserve" &&
      isNodeOfType(call.callee.object, "MemberExpression") &&
      getStaticPropertyName(call.callee.object) === "current" &&
      hookModule.scopes.symbolFor(call.callee.object.object) === observerSymbol
    )
      continue;
    return null;
  }

  const consumer = readHookResultUse(callerModule, input.hookSource, input.hookExport);
  const callerFields = consumer && propertyMap(consumer.id);
  const receivedRef = callerFields?.get(field);
  const receivedInit = callerFields?.get(input.observerField);
  if (!receivedRef || !receivedInit) return null;
  const callerRef = callerModule.scopes.symbolFor(receivedRef);
  const callerInit = callerModule.scopes.symbolFor(receivedInit);
  if (!hasClosedSymbol(callerRef, callerModule) || !hasClosedSymbol(callerInit, callerModule))
    return null;
  const caller = findEnclosingFunction(callerRef.bindingIdentifier);
  if (!caller || findEnclosingFunction(callerInit.bindingIdentifier) !== caller) return null;
  const initializationSites = readObserverMirrorSites(callerInit, callerRef, callerModule);
  if (!initializationSites) return null;
  let attachment: EsTreeNodeOfType<"JSXOpeningElement"> | null = null;
  let propertyName: string | null = null;
  for (const { identifier } of valueReferences(callerRef)) {
    if (
      isDependencyRead(identifier, callerModule.scopes) ||
      initializationSites.some((call) => call.arguments[0] === identifier)
    )
      continue;
    const expression = identifier.parent;
    const attribute = expression?.parent;
    const opening = attribute?.parent;
    if (
      attachment ||
      !isNodeOfType(expression, "JSXExpressionContainer") ||
      expression.expression !== identifier ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      attribute.value !== expression ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier")
    )
      return null;
    const childBinding = callerModule.scopes.symbolFor(opening.name);
    const imported =
      childBinding?.kind === "import"
        ? resolveImportedApiReference(childBinding.bindingIdentifier, callerModule.scopes)
        : null;
    const received = attribute.name.name;
    if (
      imported?.source !== input.childSource ||
      imported.importedName !== input.childExport ||
      !isRenderedInsideOwner(opening, caller) ||
      opening.attributes.some(
        (item) =>
          item !== attribute &&
          (!isNodeOfType(item, "JSXAttribute") ||
            !isNodeOfType(item.name, "JSXIdentifier") ||
            item.name.name === received),
      )
    )
      return null;
    attachment = opening;
    propertyName = received;
  }
  return attachment && propertyName
    ? {
        hookRef: ref,
        refField: field,
        receivingChild: attachment,
        receivingProp: propertyName,
        initializationSites,
        observerSlots: [observeSlot],
      }
    : null;
};
