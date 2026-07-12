import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const isStaticPattern = (argument: EsTreeNode | null | undefined): boolean => {
  if (!argument) return false;
  const unwrappedArgument = stripParenExpression(argument);
  if (isNodeOfType(unwrappedArgument, "Literal")) return true;
  return (
    isNodeOfType(unwrappedArgument, "TemplateLiteral") &&
    (unwrappedArgument.expressions?.length ?? 0) === 0
  );
};

const STATEFUL_REGEXP_FLAGS_PATTERN = /[gy]/;
const VALID_REGEXP_FLAGS_PATTERN = /^[dgimsuvy]*$/;
const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set([
  "globalThis",
  "global",
  "window",
  "self",
]);

const getStaticStringValue = (argument: EsTreeNode | null | undefined): string | null => {
  if (!argument) return null;
  const unwrappedArgument = stripParenExpression(argument);
  if (isNodeOfType(unwrappedArgument, "Literal") && typeof unwrappedArgument.value === "string") {
    return unwrappedArgument.value;
  }
  if (
    isNodeOfType(unwrappedArgument, "TemplateLiteral") &&
    (unwrappedArgument.expressions?.length ?? 0) === 0
  ) {
    const value = unwrappedArgument.quasis?.[0]?.value?.cooked;
    return typeof value === "string" ? value : null;
  }
  return null;
};

const getEffectiveRegExpFlags = (
  patternArgument: EsTreeNode | null | undefined,
  flagsArgument: EsTreeNode | null | undefined,
): string | null => {
  if (flagsArgument) return getStaticStringValue(flagsArgument);
  if (!patternArgument) return "";
  const unwrappedPattern = stripParenExpression(patternArgument);
  if (isNodeOfType(unwrappedPattern, "Literal") && unwrappedPattern.value instanceof RegExp) {
    return unwrappedPattern.value.flags;
  }
  return "";
};

const hasValidRegExpFlags = (flags: string): boolean =>
  VALID_REGEXP_FLAGS_PATTERN.test(flags) &&
  new Set(flags).size === flags.length &&
  !(flags.includes("u") && flags.includes("v"));

const getDestructuredBindingPropertyName = (bindingIdentifier: EsTreeNode): string | null => {
  let bindingNode = bindingIdentifier;
  if (
    isNodeOfType(bindingNode.parent, "AssignmentPattern") &&
    bindingNode.parent.left === bindingNode
  ) {
    bindingNode = bindingNode.parent;
  }
  const property = bindingNode.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== bindingNode ||
    !isNodeOfType(property.parent, "ObjectPattern")
  ) {
    return null;
  }
  return getStaticPropertyKeyName(property, { allowComputedString: true });
};

const extendGlobalPath = (basePath: string, propertyName: string | null): string | null => {
  if (basePath === "global") {
    if (propertyName === null || GLOBAL_OBJECT_NAMES.has(propertyName)) return "global";
    return propertyName === "Object" || propertyName === "Reflect" ? propertyName : null;
  }
  if ((basePath === "Object" || basePath === "Reflect") && propertyName) {
    return `${basePath}.${propertyName}`;
  }
  return null;
};

const getGlobalPath = (
  node: EsTreeNode,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): string | null => {
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "Identifier")) {
    if (
      GLOBAL_OBJECT_NAMES.has(unwrappedNode.name) &&
      context.scopes.isGlobalReference(unwrappedNode)
    ) {
      return "global";
    }
    if (
      (unwrappedNode.name === "Object" || unwrappedNode.name === "Reflect") &&
      context.scopes.isGlobalReference(unwrappedNode)
    ) {
      return unwrappedNode.name;
    }
    const symbol = context.scopes.symbolFor(unwrappedNode);
    if (symbol?.kind !== "const" || !symbol.initializer) return null;
    const cachedResult = symbolCache.get(symbol.id);
    if (cachedResult !== undefined) return cachedResult || null;
    symbolCache.set(symbol.id, false);
    if (!symbol.references.every((reference) => reference.flag === "read")) return null;
    const initializerPath = getGlobalPath(symbol.initializer, context, symbolCache);
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    const resolvedPath = destructuredPropertyName
      ? initializerPath && extendGlobalPath(initializerPath, destructuredPropertyName)
      : initializerPath;
    symbolCache.set(symbol.id, resolvedPath ?? false);
    return resolvedPath;
  }
  if (!isNodeOfType(unwrappedNode, "MemberExpression")) return null;
  const objectPath = getGlobalPath(unwrappedNode.object, context, symbolCache);
  if (!objectPath) return null;
  const propertyName = getStaticPropertyName(unwrappedNode);
  return extendGlobalPath(objectPath, propertyName);
};

const assignmentTargetMayReplaceGlobalRegExp = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): boolean => {
  if (!node) return false;
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "MemberExpression")) {
    if (getGlobalPath(target.object, context, symbolCache) !== "global") return false;
    const propertyName = getStaticPropertyName(target);
    return propertyName === null || propertyName === "RegExp";
  }
  if (isNodeOfType(target, "AssignmentPattern")) {
    return assignmentTargetMayReplaceGlobalRegExp(target.left, context, symbolCache);
  }
  if (isNodeOfType(target, "RestElement")) {
    return assignmentTargetMayReplaceGlobalRegExp(target.argument, context, symbolCache);
  }
  if (isNodeOfType(target, "ArrayPattern")) {
    return target.elements.some((element) =>
      assignmentTargetMayReplaceGlobalRegExp(element, context, symbolCache),
    );
  }
  if (isNodeOfType(target, "ObjectPattern")) {
    return target.properties.some((property) =>
      assignmentTargetMayReplaceGlobalRegExp(
        isNodeOfType(property, "Property") ? property.value : property,
        context,
        symbolCache,
      ),
    );
  }
  return false;
};

const getWriteTarget = (node: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(node, "AssignmentExpression")) return node.left;
  if (isNodeOfType(node, "UpdateExpression")) return node.argument;
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
    return node.argument;
  }
  if (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) {
    return node.left;
  }
  return null;
};

const objectExpressionMayDefineRegExp = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return true;
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "ObjectExpression")) return true;
  return unwrappedNode.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName === null || propertyName === "RegExp";
  });
};

const callMayReplaceGlobalRegExp = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): boolean => {
  const methodName = getGlobalPath(node.callee, context, symbolCache);
  const target = node.arguments?.[0];
  if (!target || getGlobalPath(target, context, symbolCache) !== "global") {
    return false;
  }
  if (
    methodName === "Object.defineProperty" ||
    methodName === "Reflect.set" ||
    methodName === "Reflect.defineProperty"
  ) {
    const propertyName = getStaticStringValue(node.arguments?.[1]);
    return propertyName === null || propertyName === "RegExp";
  }
  if (methodName === "Object.defineProperties") {
    return objectExpressionMayDefineRegExp(node.arguments?.[1]);
  }
  if (methodName === "Object.assign") {
    return (node.arguments?.slice(1) ?? []).some(objectExpressionMayDefineRegExp);
  }
  return false;
};

const hasGlobalRegExpMemberReassignment = (context: RuleContext): boolean => {
  let hasReassignment = false;
  const symbolCache = new Map<number, string | false>();
  walkAst(context.scopes.rootScope.node, (node: EsTreeNode): boolean | void => {
    if (hasReassignment) return false;
    const writeTarget = getWriteTarget(node);
    if (writeTarget && assignmentTargetMayReplaceGlobalRegExp(writeTarget, context, symbolCache)) {
      hasReassignment = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      callMayReplaceGlobalRegExp(node, context, symbolCache)
    ) {
      hasReassignment = true;
      return false;
    }
  });
  return hasReassignment;
};

const hasGlobalRegExpReassignment = (context: RuleContext): boolean => {
  const pendingScopes = [context.scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) continue;
    if (
      currentScope.references.some(
        (reference) =>
          reference.resolvedSymbol === null &&
          reference.flag !== "read" &&
          isNodeOfType(reference.identifier, "Identifier") &&
          reference.identifier.name === "RegExp",
      )
    ) {
      return true;
    }
    pendingScopes.push(...currentScope.children);
  }
  return hasGlobalRegExpMemberReassignment(context);
};

// `RegExp(...)` without `new` constructs a fresh regex exactly like
// `new RegExp(...)` does, so both call forms get the same treatment.
const isStaticRegExpConstruction = (
  node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  getHasReassignedGlobalRegExp: () => boolean,
): boolean => {
  const patternArgument = node.arguments?.[0] as EsTreeNode | undefined;
  const flagsArgument = node.arguments?.[1] as EsTreeNode | undefined;
  const callee = stripParenExpression(node.callee);
  const effectiveFlags = getEffectiveRegExpFlags(patternArgument, flagsArgument);
  return (
    isNodeOfType(callee, "Identifier") &&
    callee.name === "RegExp" &&
    context.scopes.isGlobalReference(callee) &&
    isStaticPattern(patternArgument) &&
    effectiveFlags !== null &&
    hasValidRegExpFlags(effectiveFlags) &&
    !STATEFUL_REGEXP_FLAGS_PATTERN.test(effectiveFlags) &&
    !getHasReassignedGlobalRegExp()
  );
};

const MESSAGE =
  "`new RegExp()` rebuilds the pattern on every loop pass. Move it to a constant outside the loop.";

export const jsHoistRegexp = defineRule({
  id: "js-hoist-regexp",
  title: "RegExp built inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move `new RegExp(...)` (or large regex literals) to a constant outside the loop so it isn't rebuilt on every pass",
  create: (context: RuleContext) => {
    let hasReassignedGlobalRegExp: boolean | null = null;
    const getHasReassignedGlobalRegExp = (): boolean => {
      hasReassignedGlobalRegExp ??= hasGlobalRegExpReassignment(context);
      return hasReassignedGlobalRegExp;
    };
    return createLoopAwareVisitors(
      {
        NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
          if (isStaticRegExpConstruction(node, context, getHasReassignedGlobalRegExp)) {
            context.report({ node, message: MESSAGE });
          }
        },
        CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
          if (isStaticRegExpConstruction(node, context, getHasReassignedGlobalRegExp)) {
            context.report({ node, message: MESSAGE });
          }
        },
      },
      { treatIteratorCallbacksAsLoops: true },
    );
  },
});
