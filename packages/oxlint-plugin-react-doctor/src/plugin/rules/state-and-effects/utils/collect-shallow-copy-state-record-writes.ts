import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ClosedRecordArray {
  readonly state: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly containers: Map<SymbolDescriptor, "builder" | "copy">;
  readonly records: ReadonlyArray<EsTreeNode>;
}

interface ClosedNumericIndexList {
  readonly state: SymbolDescriptor;
}

const INTRINSIC_GLOBAL_NAMES = new Set([
  "Array",
  "Object",
  "Symbol",
  "Reflect",
  "Function",
  "eval",
  "globalThis",
  "window",
  "self",
  "global",
  "arguments",
]);
const INTRINSIC_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "defaultView",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
const ARRAY_PROTOCOL_PROPERTY_NAMES = new Set([
  "length",
  "map",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "copyWithin",
  "fill",
  "filter",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "at",
  "entries",
  "keys",
  "values",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "every",
  "some",
  "reduce",
  "reduceRight",
  "includes",
  "indexOf",
  "lastIndexOf",
  "join",
  "toString",
  "toLocaleString",
  "valueOf",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
]);

const ABSENT_KEY_REFLECTION_METHOD_NAMES = new Set([
  "defineProperty",
  "defineProperties",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "create",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
const ABSENT_KEY_PATTERN_PROPERTY_NAMES = new Set([
  ...INTRINSIC_GLOBAL_NAMES,
  ...INTRINSIC_PROPERTY_NAMES,
  ...ABSENT_KEY_REFLECTION_METHOD_NAMES,
  "require",
]);
const ABSENT_KEY_FORBIDDEN_PROPERTY_NAMES = new Set([
  ...INTRINSIC_PROPERTY_NAMES,
  ...ARRAY_PROTOCOL_PROPERTY_NAMES,
  ...ABSENT_KEY_REFLECTION_METHOD_NAMES,
  "isPrototypeOf",
  "hasOwnProperty",
  "propertyIsEnumerable",
  "then",
  "toJSON",
]);
const absentKeyProviderAccessCache = new WeakMap<ScopeAnalysis, boolean>();

const hasVisibleAbsentKeyProviderAccess = (context: RuleContext): boolean => {
  const cached = absentKeyProviderAccessCache.get(context.scopes);
  if (cached !== undefined) return cached;
  let hasAccess = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (
      hasAccess ||
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    )
      return false;
    if (isTypeScriptTypePosition(node)) return;
    if (isNodeOfType(node, "TSParameterProperty")) {
      hasAccess = true;
    } else if (isNodeOfType(node, "ObjectPattern")) {
      hasAccess = node.properties.some((property) => {
        if (!isNodeOfType(property, "Property") || property.computed) return true;
        const propertyName = getStaticPropertyKeyName(property);
        return propertyName === null || ABSENT_KEY_PATTERN_PROPERTY_NAMES.has(propertyName);
      });
    } else if (
      isNodeOfType(node, "MemberExpression") &&
      ABSENT_KEY_REFLECTION_METHOD_NAMES.has(getStaticPropertyName(node) ?? "")
    ) {
      hasAccess = true;
    }
  });
  absentKeyProviderAccessCache.set(context.scopes, hasAccess);
  return hasAccess;
};

const isNumericLoopIndex = (node: EsTreeNode, context: RuleContext): boolean => {
  const symbol = context.scopes.symbolFor(node);
  if (
    !symbol ||
    symbol.kind !== "let" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.initializer, "Literal") ||
    typeof symbol.initializer.value !== "number" ||
    !Number.isInteger(symbol.initializer.value) ||
    symbol.initializer.value < 0
  )
    return false;
  return symbol.references.every(
    (reference) =>
      reference.flag === "read" ||
      (isNodeOfType(reference.identifier.parent, "UpdateExpression") &&
        reference.identifier.parent.operator === "++"),
  );
};

const hasVisibleIntrinsicAccess = (proof: ClosedRecordArray, context: RuleContext): boolean => {
  let hasAccess = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasAccess) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isTypeScriptTypePosition(node) &&
      INTRINSIC_GLOBAL_NAMES.has(node.name)
    ) {
      const symbol = context.scopes.symbolFor(node);
      if (
        context.scopes.isGlobalReference(node) ||
        (symbol &&
          (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
          !hasRuntimeValueBinding(symbol))
      )
        hasAccess = true;
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      (INTRINSIC_PROPERTY_NAMES.has(getStaticPropertyName(node) ?? "") ||
        (node.computed &&
          !(
            isNodeOfType(node.property, "Literal") &&
            (typeof node.property.value === "string" || typeof node.property.value === "number")
          ) &&
          !(
            isNodeOfType(node.property, "Identifier") &&
            (isNumericLoopIndex(node.property, context) ||
              (isNodeOfType(node.object, "Identifier") &&
                (context.scopes.symbolFor(node.object) === proof.state ||
                  Array.from(proof.containers.keys()).some(
                    (container) => container === context.scopes.symbolFor(node.object),
                  ))))
          )))
    )
      hasAccess = true;
  });
  return hasAccess;
};

const readonlySymbols = new WeakMap<SymbolDescriptor, boolean>();

const symbolIsReadonly = (symbol: SymbolDescriptor): boolean => {
  const cached = readonlySymbols.get(symbol);
  if (cached !== undefined) return cached;
  const readonly = symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );
  readonlySymbols.set(symbol, readonly);
  return readonly;
};

const getConstSymbol = (node: EsTreeNode, context: RuleContext): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(node);
  return symbol?.kind === "const" && symbolIsReadonly(symbol) ? symbol : null;
};

const recordDataKeys = (record: EsTreeNode): ReadonlySet<string> | null => {
  if (!isNodeOfType(record, "ObjectExpression")) return null;
  const keys = new Set<string>();
  for (const property of record.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || INTRINSIC_PROPERTY_NAMES.has(key) || keys.has(key)) return null;
    keys.add(key);
  }
  return keys;
};

const getArrayRecords = (node: EsTreeNode): ReadonlyArray<EsTreeNode> | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ArrayExpression")) return null;
  const records: EsTreeNode[] = [];
  for (const element of expression.elements) {
    if (!element || !recordDataKeys(element)) return null;
    records.push(element);
  }
  return records;
};

const isStateCopy = (node: EsTreeNode, state: SymbolDescriptor, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ArrayExpression") || expression.elements.length !== 1)
    return false;
  const element = expression.elements[0];
  return (
    isNodeOfType(element, "SpreadElement") &&
    isNodeOfType(element.argument, "Identifier") &&
    context.scopes.symbolFor(element.argument) === state
  );
};

const collectClosedRecordArray = (
  binding: UseStateBinding,
  context: RuleContext,
): ClosedRecordArray | null => {
  const declarator = binding.declarator;
  if (
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression")
  )
    return null;
  const [stateIdentifier, setterIdentifier] = declarator.id.elements;
  if (!isNodeOfType(stateIdentifier, "Identifier") || !isNodeOfType(setterIdentifier, "Identifier"))
    return null;
  const state = getConstSymbol(stateIdentifier, context);
  const setter = getConstSymbol(setterIdentifier, context);
  const callee = declarator.init.callee;
  if (
    !state ||
    !setter ||
    !isNodeOfType(callee, "Identifier") ||
    !isReactApiCall(declarator.init, "useState", context.scopes)
  )
    return null;
  const hook = context.scopes.symbolFor(callee);
  if (!hook || !isNodeOfType(hook.declarationNode, "ImportSpecifier") || !symbolIsReadonly(hook))
    return null;
  if (
    hook.references.some((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      return !isNodeOfType(root.parent, "CallExpression") || root.parent.callee !== root;
    })
  )
    return null;
  const initializer = declarator.init.arguments[0];
  const initialRecords = initializer ? getArrayRecords(initializer) : null;
  if (!initialRecords) return null;
  const records = [...initialRecords];
  const containers = new Map<SymbolDescriptor, "builder" | "copy">();
  for (const reference of setter.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.optional ||
      call.arguments.length !== 1
    )
      return null;
    const argument = call.arguments[0];
    if (!argument || isNodeOfType(argument, "SpreadElement")) return null;
    const expression = stripParenExpression(argument);
    const literalRecords = getArrayRecords(expression);
    if (literalRecords) {
      records.push(...literalRecords);
      continue;
    }
    const container = getConstSymbol(expression, context);
    if (!container?.initializer || !isNodeOfType(container.declarationNode, "VariableDeclarator"))
      return null;
    if (findEnclosingFunction(container.declarationNode) !== findEnclosingFunction(call))
      return null;
    if (container.declarationNode.range[0] >= call.range[0]) return null;
    if (isStateCopy(container.initializer, state, context)) {
      containers.set(container, "copy");
    } else {
      const builderRecords = getArrayRecords(container.initializer);
      if (!builderRecords) return null;
      records.push(...builderRecords);
      containers.set(container, "builder");
    }
  }
  for (const [container, kind] of containers) {
    if (kind !== "builder") continue;
    for (const reference of container.references) {
      const root = findTransparentExpressionRoot(reference.identifier);
      const member = root.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        getStaticPropertyName(member) !== "push"
      )
        continue;
      const call = member.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== member ||
        call.optional ||
        call.arguments.length !== 1
      )
        return null;
      const record = call.arguments[0];
      if (
        !record ||
        !recordDataKeys(record) ||
        findEnclosingFunction(call) !== findEnclosingFunction(container.declarationNode)
      )
        return null;
      records.push(record);
    }
  }
  return records.length > 0 ? { state, setter, containers, records } : null;
};

const isSetterFeed = (
  node: EsTreeNode,
  proof: ClosedRecordArray,
  context: RuleContext,
): boolean => {
  const parent = node.parent;
  return (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.length === 1 &&
    parent.arguments[0] === node &&
    isNodeOfType(parent.callee, "Identifier") &&
    context.scopes.symbolFor(parent.callee) === proof.setter
  );
};

const recordFieldIsClosed = (identifier: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(identifier);
  const member = root.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== root ||
    !getStaticPropertyName(member)
  )
    return false;
  const parent = findTransparentExpressionRoot(member).parent;
  return (
    !(isNodeOfType(parent, "AssignmentExpression") && parent.left === member) &&
    !isNodeOfType(parent, "MemberExpression") &&
    !isNodeOfType(parent, "UpdateExpression") &&
    !(isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete") &&
    !(isNodeOfType(parent, "CallExpression") && parent.callee === member)
  );
};

const functionHasSelfReferences = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "FunctionExpression") || !node.id) return false;
  const selfBinding = context.scopes.symbolFor(node.id);
  return !selfBinding || selfBinding.references.length > 0;
};

const getStateMapCallback = (member: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (!isNodeOfType(member, "MemberExpression") || getStaticPropertyName(member) !== "map")
    return null;
  const call = member.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== member ||
    call.optional ||
    call.arguments.length !== 1
  )
    return null;
  const callback = call.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  )
    return null;
  if (
    callback.async ||
    callback.generator ||
    callback.params.length > 2 ||
    functionHasSelfReferences(callback, context)
  )
    return null;
  const recordParameter = callback.params[0];
  if (!isNodeOfType(recordParameter, "Identifier")) return null;
  const record = context.scopes.symbolFor(recordParameter);
  if (
    !record ||
    !symbolIsReadonly(record) ||
    !record.references.every((reference) => recordFieldIsClosed(reference.identifier))
  )
    return null;
  return callback;
};

const containerReferencesAreClosed = (proof: ClosedRecordArray, context: RuleContext): boolean => {
  const containers = new Map<SymbolDescriptor, string>(proof.containers);
  containers.set(proof.state, "state");
  for (const [container, kind] of containers) {
    for (const reference of container.references) {
      const root = findTransparentExpressionRoot(reference.identifier);
      if (isSetterFeed(root, proof, context) && kind !== "state") continue;
      const parent = root.parent;
      if (
        kind === "state" &&
        isNodeOfType(parent, "SpreadElement") &&
        isNodeOfType(parent.parent, "ArrayExpression")
      ) {
        const declaration = parent.parent.parent;
        if (
          isNodeOfType(declaration, "VariableDeclarator") &&
          isNodeOfType(declaration.id, "Identifier") &&
          Array.from(proof.containers).some(
            ([container, kind]) =>
              container === context.scopes.symbolFor(declaration.id) && kind === "copy",
          )
        )
          continue;
      }
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root || parent.optional)
        return false;
      const memberName = getStaticPropertyName(parent);
      if (memberName === "length") {
        const next = findTransparentExpressionRoot(parent).parent;
        if (!isNodeOfType(next, "AssignmentExpression") && !isNodeOfType(next, "UpdateExpression"))
          continue;
        return false;
      }
      if (kind === "builder" && memberName === "push") {
        const call = parent.parent;
        if (isNodeOfType(call, "CallExpression") && call.callee === parent) continue;
        return false;
      }
      if (kind === "state" && getStateMapCallback(parent, context)) continue;
      if (kind === "builder" || !parent.computed) return false;
      const field = findTransparentExpressionRoot(parent).parent;
      if (!isNodeOfType(field, "MemberExpression") || field.object !== parent || field.optional)
        return false;
      const fieldName = getStaticPropertyName(field);
      if (!fieldName || INTRINSIC_PROPERTY_NAMES.has(fieldName)) return false;
      const next = findTransparentExpressionRoot(field).parent;
      if (isNodeOfType(next, "AssignmentExpression") && next.left === field) {
        if (
          kind !== "copy" ||
          next.operator !== "=" ||
          ARRAY_PROTOCOL_PROPERTY_NAMES.has(fieldName)
        )
          return false;
      } else if (
        isNodeOfType(next, "MemberExpression") ||
        isNodeOfType(next, "UpdateExpression") ||
        (isNodeOfType(next, "UnaryExpression") && next.operator === "delete") ||
        (isNodeOfType(next, "CallExpression") && next.callee === field)
      )
        return false;
    }
  }
  return true;
};

const isMapIndex = (
  identifier: EsTreeNode,
  proof: ClosedRecordArray,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "parameter" || !symbolIsReadonly(symbol)) return false;
  const callback = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  )
    return false;
  if (callback.params[1] !== symbol.bindingIdentifier) return false;
  const call = callback.parent;
  if (!isNodeOfType(call, "CallExpression") || !isNodeOfType(call.callee, "MemberExpression"))
    return false;
  const receiver = stripParenExpression(call.callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    context.scopes.symbolFor(receiver) === proof.state &&
    getStateMapCallback(call.callee, context) === callback
  );
};

const isCanonicalIndex = (
  node: EsTreeNode,
  proof: ClosedRecordArray,
  context: RuleContext,
): boolean => {
  if (isMapIndex(node, proof, context)) return true;
  if (!isNodeOfType(node, "Identifier")) return false;
  const parameter = context.scopes.symbolFor(node);
  if (!parameter || parameter.kind !== "parameter" || !symbolIsReadonly(parameter)) return false;
  const handler = findEnclosingFunction(parameter.bindingIdentifier);
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") &&
    !isNodeOfType(handler, "FunctionExpression")
  )
    return false;
  if (handler.async || handler.generator || functionHasSelfReferences(handler, context))
    return false;
  const position = handler.params.findIndex(
    (candidate) => candidate === parameter.bindingIdentifier,
  );
  const [binding] = getFunctionBindingSymbols(handler, context.scopes);
  if (
    position < 0 ||
    !binding ||
    binding.kind !== "const" ||
    !symbolIsReadonly(binding) ||
    binding.references.length === 0
  )
    return false;
  return binding.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      call.callee === root &&
      !call.optional &&
      Boolean(call.arguments[position] && isMapIndex(call.arguments[position], proof, context))
    );
  });
};

const numericIndexListsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlyMap<SymbolDescriptor, ClosedNumericIndexList>>
>();

const getNumericListCallback = (
  member: EsTreeNode,
  list: ClosedNumericIndexList,
  methodName: "map" | "filter",
  context: RuleContext,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    getStaticPropertyName(member) !== methodName
  )
    return null;
  const receiver = stripParenExpression(member.object);
  const call = member.parent;
  if (
    !isNodeOfType(receiver, "Identifier") ||
    context.scopes.symbolFor(receiver) !== list.state ||
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== member ||
    call.optional ||
    call.arguments.length !== 1
  )
    return null;
  const callback = stripParenExpression(call.arguments[0]);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length < 1 ||
    callback.params.length > 2 ||
    callback.params.some((parameter) => {
      if (!isNodeOfType(parameter, "Identifier")) return true;
      const symbol = context.scopes.symbolFor(parameter);
      return !symbol || !symbolIsReadonly(symbol);
    })
  )
    return null;
  return callback;
};

const isNumericListMapValue = (
  node: EsTreeNode,
  list: ClosedNumericIndexList,
  context: RuleContext,
): boolean => {
  const value = stripParenExpression(node);
  if (!isNodeOfType(value, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(value);
  if (!symbol || symbol.kind !== "parameter" || !symbolIsReadonly(symbol)) return false;
  const callback = findEnclosingFunction(symbol.bindingIdentifier);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params[0] !== symbol.bindingIdentifier
  )
    return false;
  const call = findTransparentExpressionRoot(callback).parent;
  return (
    isNodeOfType(call, "CallExpression") &&
    getNumericListCallback(call.callee, list, "map", context) === callback
  );
};

const isTransportedNumericListValue = (
  node: EsTreeNode,
  list: ClosedNumericIndexList,
  context: RuleContext,
): boolean => {
  if (isNumericListMapValue(node, list, context)) return true;
  const value = stripParenExpression(node);
  if (!isNodeOfType(value, "Identifier")) return false;
  const parameter = context.scopes.symbolFor(value);
  if (!parameter || parameter.kind !== "parameter" || !symbolIsReadonly(parameter)) return false;
  const handler = findEnclosingFunction(parameter.bindingIdentifier);
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length !== 1 ||
    handler.params[0] !== parameter.bindingIdentifier
  )
    return false;
  const [binding] = getFunctionBindingSymbols(handler, context.scopes);
  if (
    !binding ||
    binding.kind !== "const" ||
    !symbolIsReadonly(binding) ||
    binding.references.length === 0
  )
    return false;
  return binding.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      call.callee === root &&
      !call.optional &&
      call.arguments.length === 1 &&
      isNumericListMapValue(call.arguments[0], list, context)
    );
  });
};

const isNumericListFilter = (
  expression: EsTreeNode,
  list: ClosedNumericIndexList,
  proof: ClosedRecordArray,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callback = getNumericListCallback(expression.callee, list, "filter", context);
  if (!callback || callback.params.length !== 1) return false;
  const predicate = stripParenExpression(callback.body);
  if (!isNodeOfType(predicate, "BinaryExpression") || predicate.operator !== "!==") return false;
  const parameter = context.scopes.symbolFor(callback.params[0]);
  const left = stripParenExpression(predicate.left);
  const right = stripParenExpression(predicate.right);
  const valueIsLeft =
    isNodeOfType(left, "Identifier") && context.scopes.symbolFor(left) === parameter;
  const valueIsRight =
    isNodeOfType(right, "Identifier") && context.scopes.symbolFor(right) === parameter;
  if (valueIsLeft === valueIsRight) return false;
  const comparedValue = valueIsLeft ? right : left;
  return (
    isCanonicalIndex(comparedValue, proof, context) ||
    isTransportedNumericListValue(comparedValue, list, context)
  );
};

const numericListReferencesAreClosed = (
  list: ClosedNumericIndexList,
  proof: ClosedRecordArray,
  feeds: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean =>
  list.state.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      isNodeOfType(member, "SpreadElement") &&
      isNodeOfType(member.parent, "ArrayExpression") &&
      feeds.has(member.parent) &&
      member.parent.elements[0] === member
    )
      return true;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== root || member.optional)
      return false;
    const methodName = getStaticPropertyName(member);
    if (methodName === "length") {
      const parent = findTransparentExpressionRoot(member).parent;
      return (
        !isNodeOfType(parent, "AssignmentExpression") &&
        !isNodeOfType(parent, "UpdateExpression") &&
        !(isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete")
      );
    }
    if (getNumericListCallback(member, list, "map", context)) return true;
    const call = member.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== member || call.optional)
      return false;
    if (methodName === "filter")
      return feeds.has(call) && isNumericListFilter(call, list, proof, context);
    return (
      methodName === "indexOf" &&
      call.arguments.length === 1 &&
      (isCanonicalIndex(call.arguments[0], proof, context) ||
        isTransportedNumericListValue(call.arguments[0], list, context))
    );
  });

const collectClosedNumericIndexLists = (
  binding: UseStateBinding,
  proof: ClosedRecordArray,
  context: RuleContext,
): ReadonlyMap<SymbolDescriptor, ClosedNumericIndexList> => {
  let listsByBinding = numericIndexListsByScopes.get(context.scopes);
  if (!listsByBinding) {
    listsByBinding = new WeakMap();
    numericIndexListsByScopes.set(context.scopes, listsByBinding);
  }
  const cached = listsByBinding.get(binding.declarator);
  if (cached) return cached;
  const lists = new Map<SymbolDescriptor, ClosedNumericIndexList>();
  listsByBinding.set(binding.declarator, lists);
  const componentBody = binding.declarator.parent?.parent;
  const recordHook = binding.declarator.init;
  if (
    !isNodeOfType(componentBody, "BlockStatement") ||
    !isNodeOfType(recordHook, "CallExpression") ||
    !isNodeOfType(recordHook.callee, "Identifier")
  )
    return lists;
  const hook = context.scopes.symbolFor(recordHook.callee);
  for (const candidate of collectUseStateBindings(componentBody, context.scopes)) {
    const declarator = candidate.declarator;
    if (
      candidate.declarator === binding.declarator ||
      !isNodeOfType(declarator.id, "ArrayPattern") ||
      declarator.id.elements.length !== 2 ||
      !isNodeOfType(declarator.init, "CallExpression") ||
      !isNodeOfType(declarator.init.callee, "Identifier") ||
      context.scopes.symbolFor(declarator.init.callee) !== hook ||
      declarator.init.arguments.length !== 1
    )
      continue;
    const initializer = stripParenExpression(declarator.init.arguments[0]);
    if (!isNodeOfType(initializer, "ArrayExpression") || initializer.elements.length !== 0)
      continue;
    const [stateIdentifier, setterIdentifier] = declarator.id.elements;
    if (!stateIdentifier || !setterIdentifier) continue;
    const state = getConstSymbol(stateIdentifier, context);
    const setter = getConstSymbol(setterIdentifier, context);
    if (!state || !setter) continue;
    const list = { state };
    const feeds = new Set<EsTreeNode>();
    let hasAppend = false;
    const closedFeeds = setter.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const call = root.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== root ||
        call.optional ||
        call.arguments.length !== 1
      )
        return false;
      const expression = stripParenExpression(call.arguments[0]);
      feeds.add(expression);
      if (isNumericListFilter(expression, list, proof, context)) return true;
      if (!isNodeOfType(expression, "ArrayExpression") || expression.elements.length !== 2)
        return false;
      const [spread, value] = expression.elements;
      if (!isNodeOfType(spread, "SpreadElement") || !value) return false;
      const receiver = stripParenExpression(spread.argument);
      if (
        !isNodeOfType(receiver, "Identifier") ||
        context.scopes.symbolFor(receiver) !== state ||
        !isCanonicalIndex(value, proof, context)
      )
        return false;
      hasAppend = true;
      return true;
    });
    if (closedFeeds && hasAppend && numericListReferencesAreClosed(list, proof, feeds, context))
      lists.set(state, list);
  }
  return lists;
};

const getNumericListSourceState = (
  node: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Identifier")) return null;
  const parameter = context.scopes.symbolFor(expression);
  if (!parameter || parameter.kind !== "parameter") return null;
  const callback = findEnclosingFunction(parameter.bindingIdentifier);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.params[0] !== parameter.bindingIdentifier
  )
    return null;
  const call = findTransparentExpressionRoot(callback).parent;
  if (!isNodeOfType(call, "CallExpression") || !isNodeOfType(call.callee, "MemberExpression"))
    return null;
  const receiver = stripParenExpression(call.callee.object);
  return isNodeOfType(receiver, "Identifier") ? context.scopes.symbolFor(receiver) : null;
};

const isClosedNumericListIndex = (
  node: EsTreeNode,
  binding: UseStateBinding,
  proof: ClosedRecordArray,
  context: RuleContext,
): boolean => {
  if (hasVisibleAbsentKeyProviderAccess(context)) return false;
  const lists = collectClosedNumericIndexLists(binding, proof, context);
  if (lists.size === 0) return false;
  let state = getNumericListSourceState(node, context);
  if (!state) {
    const expression = stripParenExpression(node);
    if (!isNodeOfType(expression, "Identifier")) return false;
    const parameter = context.scopes.symbolFor(expression);
    if (!parameter) return false;
    const handler = findEnclosingFunction(parameter.bindingIdentifier);
    if (!handler) return false;
    const [handlerBinding] = getFunctionBindingSymbols(handler, context.scopes);
    const reference = handlerBinding?.references[0];
    if (!reference) return false;
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.arguments.length !== 1
    )
      return false;
    state = getNumericListSourceState(call.arguments[0], context);
  }
  const list = state ? lists.get(state) : null;
  return Boolean(list && isTransportedNumericListValue(node, list, context));
};

export const collectShallowCopyStateRecordWrites = (
  binding: UseStateBinding,
  context: RuleContext,
): ReadonlyArray<EsTreeNode> => {
  const proof = collectClosedRecordArray(binding, context);
  if (!proof || !Array.from(proof.containers.values()).includes("copy")) return [];
  if (hasVisibleIntrinsicAccess(proof, context) || !containerReferencesAreClosed(proof, context))
    return [];
  const recordKeys = proof.records.map(recordDataKeys);
  const commonKeys = new Set(recordKeys[0]);
  const allRecordKeys = new Set(commonKeys);
  for (const keys of recordKeys) {
    if (!keys) return [];
    for (const key of commonKeys) if (!keys.has(key)) commonKeys.delete(key);
    for (const key of keys) allRecordKeys.add(key);
  }
  const writes: EsTreeNode[] = [];
  for (const [container, kind] of proof.containers) {
    if (kind !== "copy") continue;
    for (const reference of container.references) {
      const root = findTransparentExpressionRoot(reference.identifier);
      const element = root.parent;
      if (
        !isNodeOfType(element, "MemberExpression") ||
        element.object !== root ||
        !element.computed ||
        (!isCanonicalIndex(element.property, proof, context) &&
          !isClosedNumericListIndex(element.property, binding, proof, context))
      )
        continue;
      const field = element.parent;
      if (!isNodeOfType(field, "MemberExpression") || field.object !== element) continue;
      const fieldName = getStaticPropertyName(field);
      if (
        fieldName === null ||
        (!commonKeys.has(fieldName) &&
          (ABSENT_KEY_FORBIDDEN_PROPERTY_NAMES.has(fieldName) ||
            allRecordKeys.has(fieldName) ||
            hasVisibleAbsentKeyProviderAccess(context)))
      )
        continue;
      const assignment = field.parent;
      if (
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.left !== field ||
        assignment.operator !== "="
      )
        continue;
      if (
        !isNodeReachableWithinFunction(assignment, context, {
          evaluatePrimitiveLiteralTruthiness: true,
        })
      )
        continue;
      writes.push(assignment);
    }
  }
  return writes;
};
