import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { collectConstAliasSymbols } from "../collect-const-alias-symbols.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../get-resolved-static-property-name.js";
import { getStaticStringExpression } from "../get-static-string-expression.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { resolveConstIdentifierAlias } from "../resolve-const-identifier-alias.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import {
  NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT,
  NATIVE_DELAY_OBJECT_MUTATION_METHODS,
  NATIVE_DELAY_PROTECTED_MEMBER_NAMES,
  NATIVE_DELAY_PROTOTYPE_NAMES,
  NATIVE_DELAY_REFLECT_MUTATION_METHODS,
  NATIVE_DELAY_REFLECT_SET_ARGUMENT_COUNT,
  NATIVE_DELAY_REFLECT_DELETE_ARGUMENT_COUNT,
} from "./native-signal-delay/constants.js";

const closedRecordSymbolsByScope = new WeakMap<ScopeAnalysis, Map<SymbolDescriptor, boolean>>();

const getMutationKey = (
  expression: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): string | null => {
  if (!expression) return null;
  const candidate = stripParenExpression(expression);
  const symbol = isNodeOfType(candidate, "Identifier")
    ? resolveConstIdentifierAlias(candidate, scopes)
    : null;
  return getStaticStringExpression(candidate) ?? getStaticStringExpression(symbol?.initializer);
};

const isOwnDataDescriptorLiteral = (expression: EsTreeNode): boolean => {
  const descriptor = stripParenExpression(expression);
  return (
    isNodeOfType(descriptor, "ObjectExpression") &&
    descriptor.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.computed &&
        isNodeOfType(property.key, "Identifier") &&
        ["value", "writable", "enumerable", "configurable"].includes(property.key.name),
    )
  );
};

const isOwnDataRecordLiteral = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  descriptors = false,
): boolean => {
  const record = stripParenExpression(expression);
  return (
    isNodeOfType(record, "ObjectExpression") &&
    record.properties.every((property) => {
      if (!isNodeOfType(property, "Property") || property.kind !== "init") return false;
      const key = getResolvedStaticPropertyName(property, scopes, {
        allowConstTemplateLiteral: true,
      });
      return (
        key !== null &&
        !NATIVE_DELAY_PROTOTYPE_NAMES.has(key) &&
        (!descriptors || isOwnDataDescriptorLiteral(property.value))
      );
    })
  );
};

const isClosedRecordMutationCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression") || call.optional) return false;
  const method = getResolvedStaticPropertyName(callee, scopes);
  const [, key, value, ...remaining] = call.arguments;
  if (isProvenGlobalNamespaceReference(callee.object, "Object", scopes)) {
    if (method === "assign") {
      const [, ...sources] = call.arguments;
      return sources.every((source) => isOwnDataRecordLiteral(source, scopes));
    }
    if (method === "defineProperties")
      return Boolean(key && isOwnDataRecordLiteral(key, scopes, true));
    return (
      method === "defineProperty" &&
      getMutationKey(key, scopes) !== null &&
      Boolean(value && isOwnDataDescriptorLiteral(value))
    );
  }
  if (
    !isProvenGlobalNamespaceReference(callee.object, "Reflect", scopes) ||
    getMutationKey(key, scopes) === null
  )
    return false;
  if (method === "set") return call.arguments.length === NATIVE_DELAY_REFLECT_SET_ARGUMENT_COUNT;
  if (method === "deleteProperty")
    return call.arguments.length === NATIVE_DELAY_REFLECT_DELETE_ARGUMENT_COUNT;
  return (
    method === "defineProperty" &&
    remaining.length === 0 &&
    Boolean(value && isOwnDataDescriptorLiteral(value))
  );
};

const isClosedOwnRecordReceiver = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ObjectExpression")) return candidate.properties.length === 0;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(candidate, scopes);
  if (!symbol || symbol.kind !== "const") return false;
  const cachedRecords =
    closedRecordSymbolsByScope.get(scopes) ?? new Map<SymbolDescriptor, boolean>();
  closedRecordSymbolsByScope.set(scopes, cachedRecords);
  const cachedResult = cachedRecords.get(symbol);
  if (cachedResult !== undefined) return cachedResult;
  cachedRecords.set(symbol, false);
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer) return false;
  const record = stripParenExpression(initializer);
  if (!isNodeOfType(record, "ObjectExpression") || record.properties.length !== 0) return false;
  const aliases = collectConstAliasSymbols(symbol, scopes);
  if (aliases.length > NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT) return false;
  const aliasSymbols = new Set(aliases);
  const isClosed = aliases.every((alias) =>
    alias.references.every((reference) => {
      if (reference.flag !== "read") return false;
      const root = findTransparentExpressionRoot(reference.identifier);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === root &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const target = scopes.symbolFor(parent.id);
        return Boolean(target && target.kind === "const" && aliasSymbols.has(target));
      }
      if (isNodeOfType(parent, "CallExpression")) {
        const [target] = parent.arguments;
        return target === root && isClosedRecordMutationCall(parent, scopes);
      }
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root) return false;
      const propertyName = getResolvedStaticPropertyName(parent, scopes, {
        allowConstTemplateLiteral: true,
      });
      if (!propertyName || NATIVE_DELAY_PROTOTYPE_NAMES.has(propertyName)) return false;
      const memberRoot = findTransparentExpressionRoot(parent);
      const consumer = memberRoot.parent;
      return (
        isNodeOfType(consumer, "AssignmentExpression") &&
        consumer.left === memberRoot &&
        consumer.operator === "="
      );
    }),
  );
  cachedRecords.set(symbol, isClosed);
  return isClosed;
};

const mayHaveProtectedRecordKey = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  protectedMemberNames: ReadonlySet<string>,
): boolean => {
  const record = stripParenExpression(expression);
  if (!isNodeOfType(record, "ObjectExpression")) return true;
  return record.properties.some((property) => {
    if (!isNodeOfType(property, "Property") || property.kind !== "init") return true;
    const propertyName = getResolvedStaticPropertyName(property, scopes, {
      allowConstTemplateLiteral: true,
    });
    return propertyName === null || protectedMemberNames.has(propertyName);
  });
};

export const isSupportedNativeDelayWriter = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  protectedMemberNames: ReadonlySet<string> = NATIVE_DELAY_PROTECTED_MEMBER_NAMES,
): boolean => {
  const namespaceName = isProvenGlobalNamespaceReference(node, "Object", scopes)
    ? "Object"
    : isProvenGlobalNamespaceReference(node, "Reflect", scopes)
      ? "Reflect"
      : null;
  if (namespaceName) {
    if (scopes.symbolFor(node)?.bindingIdentifier === node && !scopes.referenceFor(node))
      return true;
    const root = findTransparentExpressionRoot(node);
    const parent = root.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === root) return true;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === root &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const alias = scopes.symbolFor(parent.id);
      return Boolean(
        alias &&
        alias.kind === "const" &&
        alias.references.every((reference) => reference.flag === "read"),
      );
    }
    return (
      namespaceName === "Object" &&
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
      parent.callee === root
    );
  }
  if (!isNodeOfType(node, "MemberExpression")) return true;
  const propertyName = getResolvedStaticPropertyName(node, scopes, {
    allowConstTemplateLiteral: true,
  });
  if (isWithinAssignmentTarget(node)) {
    return (
      (propertyName !== null && !protectedMemberNames.has(propertyName)) ||
      isClosedOwnRecordReceiver(node.object, scopes)
    );
  }
  const isObjectMutation =
    isProvenGlobalNamespaceReference(node.object, "Object", scopes) &&
    propertyName !== null &&
    NATIVE_DELAY_OBJECT_MUTATION_METHODS.has(propertyName);
  const isReflectMutation =
    isProvenGlobalNamespaceReference(node.object, "Reflect", scopes) &&
    propertyName !== null &&
    NATIVE_DELAY_REFLECT_MUTATION_METHODS.has(propertyName);
  if (!isObjectMutation && !isReflectMutation) return true;
  const memberRoot = findTransparentExpressionRoot(node);
  const call = memberRoot.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== memberRoot || call.optional)
    return false;
  const [target, key, ...remaining] = call.arguments;
  if (!target || isNodeOfType(target, "SpreadElement")) return false;
  if (
    isReflectMutation &&
    propertyName === "set" &&
    call.arguments.length !== NATIVE_DELAY_REFLECT_SET_ARGUMENT_COUNT
  )
    return false;
  if (propertyName === "assign") {
    const sources = key ? [key, ...remaining] : remaining;
    if (!sources.some((source) => mayHaveProtectedRecordKey(source, scopes, protectedMemberNames)))
      return true;
  } else if (propertyName === "defineProperties") {
    if (key && !mayHaveProtectedRecordKey(key, scopes, protectedMemberNames)) return true;
  } else if (key && !isNodeOfType(key, "SpreadElement")) {
    const keyName = getMutationKey(key, scopes);
    if (keyName !== null && !protectedMemberNames.has(keyName)) return true;
  }
  return isClosedOwnRecordReceiver(target, scopes) && isClosedRecordMutationCall(call, scopes);
};
