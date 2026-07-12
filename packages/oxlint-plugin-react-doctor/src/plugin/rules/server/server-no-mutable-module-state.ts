import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import {
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
  stripParenExpression,
} from "../../utils/strip-paren-expression.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getObjectIntegrityMethodName } from "../../utils/unwrap-object-integrity-expression.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";

const MUTABLE_CONTAINER_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);
const WRITABLE_INTEGRITY_METHOD_NAMES = new Set(["seal", "preventExtensions"]);

interface MutableConstInitializer {
  containerKind: string;
  writablePropertyNames: Set<string> | null;
  nestedPropertyKinds: Map<string, string> | null;
  allowsPropertyDeletion: boolean;
}

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

const OBJECT_MUTATING_METHODS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

const ARRAY_MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const getNestedPropertyKind = (propertyValue: EsTreeNode): string | null => {
  const value = stripParenExpression(propertyValue);
  if (isNodeOfType(value, "ArrayExpression")) return "Array";
  if (isNodeOfType(value, "ObjectExpression")) return "Object";
  if (
    isNodeOfType(value, "NewExpression") &&
    isNodeOfType(value.callee, "Identifier") &&
    MUTABLE_CONTAINER_CONSTRUCTORS.has(value.callee.name)
  ) {
    return value.callee.name;
  }
  return null;
};

const getMutableConstInitializer = (
  init: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): MutableConstInitializer | null => {
  if (!init) return null;
  let initializer = stripParenExpression(init);
  let hasIntegrityWrapper = false;
  let allowsPropertyDeletion = true;
  while (isNodeOfType(initializer, "CallExpression")) {
    const methodName = getObjectIntegrityMethodName(
      initializer,
      scopes,
      WRITABLE_INTEGRITY_METHOD_NAMES,
    );
    if (!methodName) break;
    const wrappedInitializer = initializer.arguments[0];
    if (!wrappedInitializer || isNodeOfType(wrappedInitializer, "SpreadElement")) return null;
    hasIntegrityWrapper = true;
    if (methodName === "seal") allowsPropertyDeletion = false;
    initializer = stripParenExpression(wrappedInitializer);
  }

  if (hasIntegrityWrapper) {
    if (!isNodeOfType(initializer, "ObjectExpression")) return null;
    const writablePropertyNames = new Set<string>();
    const nestedPropertyKinds = new Map<string, string>();
    for (const property of initializer.properties) {
      if (isNodeOfType(property, "Property") && property.kind !== "init") continue;
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (propertyName === null || !isNodeOfType(property, "Property")) continue;
      writablePropertyNames.add(propertyName);
      const nestedPropertyKind = getNestedPropertyKind(property.value);
      if (nestedPropertyKind) nestedPropertyKinds.set(propertyName, nestedPropertyKind);
    }
    return {
      containerKind: "{}",
      writablePropertyNames,
      nestedPropertyKinds,
      allowsPropertyDeletion,
    };
  }

  if (isNodeOfType(initializer, "ArrayExpression")) {
    return {
      containerKind: "[]",
      writablePropertyNames: null,
      nestedPropertyKinds: null,
      allowsPropertyDeletion: true,
    };
  }
  if (isNodeOfType(initializer, "ObjectExpression")) {
    return {
      containerKind: "{}",
      writablePropertyNames: null,
      nestedPropertyKinds: null,
      allowsPropertyDeletion: true,
    };
  }
  if (
    isNodeOfType(initializer, "NewExpression") &&
    isNodeOfType(initializer.callee, "Identifier") &&
    MUTABLE_CONTAINER_CONSTRUCTORS.has(initializer.callee.name)
  ) {
    return {
      containerKind: `new ${initializer.callee.name}()`,
      writablePropertyNames: null,
      nestedPropertyKinds: null,
      allowsPropertyDeletion: true,
    };
  }
  return null;
};

const getMemberPropertyName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  if (!memberExpression.computed && isNodeOfType(memberExpression.property, "Identifier")) {
    return memberExpression.property.name;
  }
  if (
    memberExpression.computed &&
    isNodeOfType(memberExpression.property, "Literal") &&
    typeof memberExpression.property.value === "string"
  ) {
    return memberExpression.property.value;
  }
  return null;
};

// Walks up from a reference identifier through the member chain it roots
// (`store` -> `store.users` -> `store.users[0]`), so a mutation at any
// property depth is attributed back to the module binding.
const ascendMemberChain = (referenceIdentifier: EsTreeNode): EsTreeNode => {
  let chainTip: EsTreeNode = referenceIdentifier;
  while (chainTip.parent) {
    if (
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(chainTip.parent.type) &&
      "expression" in chainTip.parent &&
      chainTip.parent.expression === chainTip
    ) {
      chainTip = chainTip.parent;
      continue;
    }
    if (isNodeOfType(chainTip.parent, "MemberExpression") && chainTip.parent.object === chainTip) {
      chainTip = chainTip.parent;
      continue;
    }
    break;
  }
  return chainTip;
};

const isDirectContentsMutation = (referenceIdentifier: EsTreeNode): boolean => {
  const chainTip = ascendMemberChain(referenceIdentifier);
  if (chainTip === referenceIdentifier || !isNodeOfType(chainTip, "MemberExpression")) {
    return false;
  }
  const chainTipParent = chainTip.parent;
  if (!chainTipParent) return false;
  if (isNodeOfType(chainTipParent, "AssignmentExpression") && chainTipParent.left === chainTip) {
    return true;
  }
  if (isNodeOfType(chainTipParent, "UpdateExpression") && chainTipParent.argument === chainTip) {
    return true;
  }
  if (
    isNodeOfType(chainTipParent, "UnaryExpression") &&
    chainTipParent.operator === "delete" &&
    chainTipParent.argument === chainTip
  ) {
    return true;
  }
  if (isNodeOfType(chainTipParent, "CallExpression") && chainTipParent.callee === chainTip) {
    const methodName = getMemberPropertyName(chainTip);
    return methodName !== null && MUTATING_METHODS.has(methodName);
  }
  return false;
};

const getRootPropertyName = (referenceIdentifier: EsTreeNode): string | null => {
  let receiver: EsTreeNode = referenceIdentifier;
  while (
    receiver.parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(receiver.parent.type) &&
    "expression" in receiver.parent &&
    receiver.parent.expression === receiver
  ) {
    receiver = receiver.parent;
  }
  if (!receiver.parent || !isNodeOfType(receiver.parent, "MemberExpression")) return null;
  if (receiver.parent.object !== receiver) return null;
  return getMemberPropertyName(receiver.parent);
};

const isDeleteContentsMutation = (referenceIdentifier: EsTreeNode): boolean => {
  const chainTip = ascendMemberChain(referenceIdentifier);
  const chainTipParent = chainTip.parent;
  return Boolean(
    chainTipParent &&
    isNodeOfType(chainTipParent, "UnaryExpression") &&
    chainTipParent.operator === "delete" &&
    chainTipParent.argument === chainTip,
  );
};

const isDirectRootPropertyMutation = (referenceIdentifier: EsTreeNode): boolean => {
  const chainTip = ascendMemberChain(referenceIdentifier);
  if (!isNodeOfType(chainTip, "MemberExpression")) return false;
  return stripParenExpression(chainTip.object) === referenceIdentifier;
};

const isSupportedNestedMethodMutation = (
  referenceIdentifier: EsTreeNode,
  nestedPropertyKind: string,
): boolean => {
  const chainTip = ascendMemberChain(referenceIdentifier);
  const chainTipParent = chainTip.parent;
  if (
    !isNodeOfType(chainTip, "MemberExpression") ||
    !chainTipParent ||
    !isNodeOfType(chainTipParent, "CallExpression") ||
    chainTipParent.callee !== chainTip
  ) {
    return true;
  }
  const methodName = getMemberPropertyName(chainTip);
  if (!methodName) return false;
  if (nestedPropertyKind === "Array") return ARRAY_MUTATING_METHODS.has(methodName);
  if (nestedPropertyKind === "Map") {
    return methodName === "set" || methodName === "delete" || methodName === "clear";
  }
  if (nestedPropertyKind === "WeakMap") return methodName === "set" || methodName === "delete";
  if (nestedPropertyKind === "Set") {
    return methodName === "add" || methodName === "delete" || methodName === "clear";
  }
  if (nestedPropertyKind === "WeakSet") return methodName === "add" || methodName === "delete";
  return false;
};

const isKnownPropertyObjectMutation = (
  referenceIdentifier: EsTreeNode,
  writablePropertyNames: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const callExpression = referenceIdentifier.parent;
  if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return false;
  if (callExpression.arguments[0] !== referenceIdentifier) return false;
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Object" ||
    !scopes.isGlobalReference(receiver) ||
    getMemberPropertyName(callee) === "setPrototypeOf"
  ) {
    return false;
  }
  const methodName = getMemberPropertyName(callee);
  if (methodName === "defineProperty") {
    const propertyNameNode = callExpression.arguments[1];
    return Boolean(
      propertyNameNode &&
      isNodeOfType(propertyNameNode, "Literal") &&
      typeof propertyNameNode.value === "string" &&
      writablePropertyNames.has(propertyNameNode.value),
    );
  }
  const propertyObject = callExpression.arguments[1];
  if (methodName !== "assign" && methodName !== "defineProperties") return false;
  if (!isNodeOfType(propertyObject, "ObjectExpression")) {
    return writablePropertyNames.size > 0;
  }
  return propertyObject.properties.some((property) => {
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName !== null && writablePropertyNames.has(propertyName);
  });
};

// A bare reference passed as a call argument mutates the container when the
// call is `Object.assign(X, …)`-shaped, or when the callee is a same-file
// function whose matching parameter is mutated in its body (one hop only —
// deeper escapes stay silent so read-only lookup helpers are never flagged).
const isMutatedThroughCallArgument = (
  referenceIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
  mayFollowCalleeHop: boolean,
  initializer: MutableConstInitializer | null = null,
): boolean => {
  const callExpression = referenceIdentifier.parent;
  if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return false;
  const callArguments = callExpression.arguments ?? [];
  const referenceArgumentIndex = callArguments.findIndex(
    (callArgument) => callArgument === referenceIdentifier,
  );
  if (referenceArgumentIndex === -1) return false;

  const callee = callExpression.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getMemberPropertyName(callee);
    const calleeReceiver = stripParenExpression(callee.object);
    return Boolean(
      isNodeOfType(calleeReceiver, "Identifier") &&
      calleeReceiver.name === "Object" &&
      scopes.isGlobalReference(calleeReceiver) &&
      methodName !== null &&
      OBJECT_MUTATING_METHODS.has(methodName) &&
      referenceArgumentIndex === 0 &&
      (!initializer?.writablePropertyNames ||
        isKnownPropertyObjectMutation(
          referenceIdentifier,
          initializer.writablePropertyNames,
          scopes,
        )),
    );
  }

  if (!mayFollowCalleeHop || !isNodeOfType(callee, "Identifier")) return false;
  const calleeSymbol = scopes.symbolFor(callee);
  if (!calleeSymbol) return false;
  const calleeFunction = calleeSymbol.initializer;
  if (!isFunctionLike(calleeFunction)) return false;
  const parameter = calleeFunction.params?.[referenceArgumentIndex];
  if (!parameter || !isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  if (!parameterSymbol) return false;
  return parameterSymbol.references.some(
    (parameterReference) =>
      isAllowedDirectMutation(parameterReference.identifier, initializer) ||
      isMutatedThroughCallArgument(parameterReference.identifier, scopes, false, initializer),
  );
};

const isAllowedDirectMutation = (
  referenceIdentifier: EsTreeNode,
  initializer: MutableConstInitializer | null,
): boolean => {
  if (!isDirectContentsMutation(referenceIdentifier)) return false;
  if (!initializer?.writablePropertyNames) return true;
  const rootPropertyName = getRootPropertyName(referenceIdentifier);
  if (!rootPropertyName || !initializer.writablePropertyNames.has(rootPropertyName)) return false;
  if (isDirectRootPropertyMutation(referenceIdentifier)) {
    return initializer.allowsPropertyDeletion || !isDeleteContentsMutation(referenceIdentifier);
  }
  const nestedPropertyKind = initializer.nestedPropertyKinds?.get(rootPropertyName);
  return Boolean(
    nestedPropertyKind && isSupportedNestedMethodMutation(referenceIdentifier, nestedPropertyKind),
  );
};

// Module-level `const byId = cache` aliases share the container, so a
// mutation through any alias counts toward the original binding.
const collectAliasGroup = (
  containerSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const aliasGroup = [containerSymbol];
  const seenSymbols = new Set([containerSymbol]);
  for (const groupSymbol of aliasGroup) {
    for (const reference of groupSymbol.references) {
      const declarator = reference.identifier.parent;
      if (
        !declarator ||
        !isNodeOfType(declarator, "VariableDeclarator") ||
        declarator.init !== reference.identifier
      ) {
        continue;
      }
      const aliasSymbol = scopes.symbolFor(declarator.id);
      if (!aliasSymbol || aliasSymbol.scope.kind !== "module" || seenSymbols.has(aliasSymbol)) {
        continue;
      }
      seenSymbols.add(aliasSymbol);
      aliasGroup.push(aliasSymbol);
    }
  }
  return aliasGroup;
};

// True when the binding's contents are written anywhere in the module: a
// member assignment (`X.y = …`, `X.a[i] = …` at any depth), `delete X.y`, a
// mutating method call (`X.push(...)`, `X.users.push(...)`, `X["set"](...)`),
// `Object.assign(X, …)`, or an escape into a same-file callee that mutates
// the parameter. Resolution is scope-aware, so a shadowed local or parameter
// of the same name never counts. A const container that is never mutated is
// an immutable lookup table — sharing it across requests is correct, so it
// must NOT be flagged.
const isContainerContentsMutated = (
  containerSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  initializer: MutableConstInitializer,
): boolean =>
  collectAliasGroup(containerSymbol, scopes).some((groupSymbol) =>
    groupSymbol.references.some(
      (reference) =>
        isInsideFunctionScope(reference.identifier) &&
        (isAllowedDirectMutation(reference.identifier, initializer) ||
          isMutatedThroughCallArgument(reference.identifier, scopes, true, initializer)),
    ),
  );

// HACK: in `"use server"` files, mutable module-level state (let/var, OR
// const-bound mutable containers like Map/Set/WeakMap/Array) is shared
// across concurrent requests. Different users can read each other's data,
// and serverless cold-starts produce inconsistent state. Per-request data
// must live inside the action, in headers/cookies, or in a request scope
// (React.cache, AsyncLocalStorage, etc.).
export const serverNoMutableModuleState = defineRule({
  id: "server-no-mutable-module-state",
  title: "Mutable module state on the server",
  severity: "error",
  recommendation:
    "Keep per-request data inside the action, or in headers, cookies, or `React.cache`. Module-scope `let`/`var` is shared by every request.",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      VariableDeclaration(node: EsTreeNodeOfType<"VariableDeclaration">) {
        if (!fileHasUseServerDirective) return;
        if (!isNodeOfType(node.parent, "Program")) return;

        for (const declarator of node.declarations ?? []) {
          const variableName = isNodeOfType(declarator.id, "Identifier")
            ? declarator.id.name
            : "<unnamed>";

          if (node.kind === "let" || node.kind === "var") {
            context.report({
              node: declarator,
              message: `Module-scoped ${node.kind} "${variableName}" is shared by every request, so any write to it leaks state between your users.`,
            });
            continue;
          }

          const initializer = getMutableConstInitializer(declarator.init, context.scopes);
          if (!initializer || !isNodeOfType(declarator.id, "Identifier")) continue;
          const containerSymbol = context.scopes.symbolFor(declarator.id);
          if (!containerSymbol) continue;
          if (isContainerContentsMutated(containerSymbol, context.scopes, initializer)) {
            context.report({
              node: declarator,
              message: `Module-scoped const "${variableName} = ${initializer.containerKind}" leaks state between your users, since every request shares it.`,
            });
          }
        }
      },
    };
  },
});
