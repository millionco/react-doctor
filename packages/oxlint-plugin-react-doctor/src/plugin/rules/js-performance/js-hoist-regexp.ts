import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
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
const GLOBAL_BUILTIN_NAMES: ReadonlySet<string> = new Set([
  "Object",
  "Reflect",
  "String",
  "RegExp",
]);
const STRING_PROTOTYPE_PATH = "String.prototype";
const REGEXP_PROTOTYPE_PATH = "RegExp.prototype";

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

const globSyncReturnsStringPaths = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))) return false;
  const callee = stripParenExpression(node.callee);
  let isGlobSyncImport = false;
  if (isNodeOfType(callee, "Identifier")) {
    const symbol = context.scopes.symbolFor(callee);
    isGlobSyncImport =
      symbol?.kind === "import" &&
      getImportedNameFromModule(callee, callee.name, "glob") === "globSync";
  } else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "globSync"
  ) {
    const symbol = context.scopes.symbolFor(callee.object);
    isGlobSyncImport =
      symbol?.kind === "import" &&
      isNamespaceImportFromModule(callee.object, callee.object.name, "glob");
  }
  if (!isGlobSyncImport) return false;
  const options = node.arguments[1];
  if (!options) return true;
  const unwrappedOptions = stripParenExpression(options);
  if (!isNodeOfType(unwrappedOptions, "ObjectExpression")) return false;
  for (const property of unwrappedOptions.properties) {
    if (!isNodeOfType(property, "Property")) return false;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return false;
    if (propertyName !== "withFileTypes") continue;
    const propertyValue = stripParenExpression(property.value);
    if (!isNodeOfType(propertyValue, "Literal") || propertyValue.value !== false) return false;
  }
  return true;
};

const isGlobSyncStringIterationBinding = (
  bindingIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declarator = bindingIdentifier.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator") || declarator.id !== bindingIdentifier) {
    return false;
  }
  const declaration = declarator.parent;
  const loop = declaration?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !isNodeOfType(loop, "ForOfStatement") ||
    loop.left !== declaration
  ) {
    return false;
  }
  const iteratedValue = stripParenExpression(loop.right);
  return (
    isNodeOfType(iteratedValue, "CallExpression") &&
    globSyncReturnsStringPaths(iteratedValue, context)
  );
};

const isProvenNativeStringReceiver = (
  node: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const receiver = stripParenExpression(node);
  if (isNodeOfType(receiver, "Literal")) return typeof receiver.value === "string";
  if (isNodeOfType(receiver, "TemplateLiteral")) return true;
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "Identifier") &&
    receiver.callee.name === "String" &&
    context.scopes.isGlobalReference(receiver.callee)
  ) {
    return true;
  }
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  if (
    isNodeOfType(symbol.bindingIdentifier, "Identifier") &&
    isNodeOfType(symbol.bindingIdentifier.typeAnnotation?.typeAnnotation, "TSStringKeyword")
  ) {
    return true;
  }
  if (isGlobSyncStringIterationBinding(symbol.bindingIdentifier, context)) return true;
  if (symbol.kind !== "const" || !symbol.initializer) return false;
  visitedSymbolIds.add(symbol.id);
  return isProvenNativeStringReceiver(symbol.initializer, context, visitedSymbolIds);
};

const isSafeStatefulReplaceAllSearch = (
  node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
  flags: string,
  context: RuleContext,
): boolean => {
  if (!flags.includes("g")) return false;
  const searchArgument = findTransparentExpressionRoot(node);
  const replaceAllCall = searchArgument.parent;
  if (
    !isNodeOfType(replaceAllCall, "CallExpression") ||
    replaceAllCall.arguments[0] !== searchArgument
  ) {
    return false;
  }
  const callee = stripParenExpression(replaceAllCall.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    !replaceAllCall.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "replaceAll" &&
    isProvenNativeStringReceiver(callee.object, context)
  );
};

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
    return propertyName && GLOBAL_BUILTIN_NAMES.has(propertyName) ? propertyName : null;
  }
  if ((basePath === "Object" || basePath === "Reflect") && propertyName) {
    return `${basePath}.${propertyName}`;
  }
  if ((basePath === "String" || basePath === "RegExp") && propertyName === "prototype") {
    return `${basePath}.prototype`;
  }
  if ((basePath === STRING_PROTOTYPE_PATH || basePath === REGEXP_PROTOTYPE_PATH) && propertyName) {
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
      GLOBAL_BUILTIN_NAMES.has(unwrappedNode.name) &&
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

const assignmentTargetMayInvalidateRegExpProof = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): boolean => {
  if (!node) return false;
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "MemberExpression")) {
    const objectPath = getGlobalPath(target.object, context, symbolCache);
    const propertyName = getStaticPropertyName(target);
    if (objectPath === "global") return propertyName === null || propertyName === "RegExp";
    if (objectPath === REGEXP_PROTOTYPE_PATH) return true;
    return (
      objectPath === STRING_PROTOTYPE_PATH &&
      (propertyName === null || propertyName === "replaceAll")
    );
  }
  if (isNodeOfType(target, "AssignmentPattern")) {
    return assignmentTargetMayInvalidateRegExpProof(target.left, context, symbolCache);
  }
  if (isNodeOfType(target, "RestElement")) {
    return assignmentTargetMayInvalidateRegExpProof(target.argument, context, symbolCache);
  }
  if (isNodeOfType(target, "ArrayPattern")) {
    return target.elements.some((element) =>
      assignmentTargetMayInvalidateRegExpProof(element, context, symbolCache),
    );
  }
  if (isNodeOfType(target, "ObjectPattern")) {
    return target.properties.some((property) =>
      assignmentTargetMayInvalidateRegExpProof(
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

const objectExpressionMayDefineProperty = (
  node: EsTreeNode | null | undefined,
  targetPropertyName: string,
): boolean => {
  if (!node) return true;
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "ObjectExpression")) return true;
  return unwrappedNode.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName === null || propertyName === targetPropertyName;
  });
};

const callMayInvalidateRegExpProof = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): boolean => {
  const methodName = getGlobalPath(node.callee, context, symbolCache);
  const target = node.arguments?.[0];
  if (!target) return false;
  const targetPath = getGlobalPath(target, context, symbolCache);
  const isSinglePropertyMutation =
    methodName === "Object.defineProperty" ||
    methodName === "Reflect.set" ||
    methodName === "Reflect.defineProperty" ||
    methodName === "Reflect.deleteProperty";
  const isPropertyCollectionMutation =
    methodName === "Object.defineProperties" || methodName === "Object.assign";
  if (targetPath === REGEXP_PROTOTYPE_PATH) {
    return (
      isSinglePropertyMutation ||
      isPropertyCollectionMutation ||
      methodName === "Object.setPrototypeOf" ||
      methodName === "Reflect.setPrototypeOf"
    );
  }
  if (targetPath === STRING_PROTOTYPE_PATH) {
    if (isSinglePropertyMutation) {
      const propertyName = getStaticStringValue(node.arguments?.[1]);
      return propertyName === null || propertyName === "replaceAll";
    }
    if (isPropertyCollectionMutation) {
      return (node.arguments?.slice(1) ?? []).some((source) =>
        objectExpressionMayDefineProperty(source, "replaceAll"),
      );
    }
    return false;
  }
  if (targetPath !== "global") return false;
  if (isSinglePropertyMutation) {
    const propertyName = getStaticStringValue(node.arguments?.[1]);
    return propertyName === null || propertyName === "RegExp";
  }
  if (methodName === "Object.defineProperties") {
    return objectExpressionMayDefineProperty(node.arguments?.[1], "RegExp");
  }
  if (methodName === "Object.assign") {
    return (node.arguments?.slice(1) ?? []).some((source) =>
      objectExpressionMayDefineProperty(source, "RegExp"),
    );
  }
  return false;
};

const hasUnsafeRegExpEnvironmentMutation = (context: RuleContext): boolean => {
  let hasUnsafeMutation = false;
  const symbolCache = new Map<number, string | false>();
  walkAst(context.scopes.rootScope.node, (node: EsTreeNode): boolean | void => {
    if (hasUnsafeMutation) return false;
    const writeTarget = getWriteTarget(node);
    if (
      writeTarget &&
      assignmentTargetMayInvalidateRegExpProof(writeTarget, context, symbolCache)
    ) {
      hasUnsafeMutation = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      callMayInvalidateRegExpProof(node, context, symbolCache)
    ) {
      hasUnsafeMutation = true;
      return false;
    }
  });
  return hasUnsafeMutation;
};

const hasUnsafeRegExpEnvironment = (context: RuleContext): boolean => {
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
  return hasUnsafeRegExpEnvironmentMutation(context);
};

// `RegExp(...)` without `new` constructs a fresh regex exactly like
// `new RegExp(...)` does, so both call forms get the same treatment.
const isStaticRegExpConstruction = (
  node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  getHasUnsafeRegExpEnvironment: () => boolean,
): boolean => {
  const patternArgument = node.arguments?.[0] as EsTreeNode | undefined;
  const flagsArgument = node.arguments?.[1] as EsTreeNode | undefined;
  const callee = stripParenExpression(node.callee);
  const effectiveFlags = getEffectiveRegExpFlags(patternArgument, flagsArgument);
  const hasStatefulFlags =
    effectiveFlags !== null && STATEFUL_REGEXP_FLAGS_PATTERN.test(effectiveFlags);
  return (
    isNodeOfType(callee, "Identifier") &&
    callee.name === "RegExp" &&
    context.scopes.isGlobalReference(callee) &&
    isStaticPattern(patternArgument) &&
    effectiveFlags !== null &&
    hasValidRegExpFlags(effectiveFlags) &&
    (!hasStatefulFlags || isSafeStatefulReplaceAllSearch(node, effectiveFlags, context)) &&
    !getHasUnsafeRegExpEnvironment()
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
    let cachedUnsafeRegExpEnvironment: boolean | null = null;
    const getHasUnsafeRegExpEnvironment = (): boolean => {
      cachedUnsafeRegExpEnvironment ??= hasUnsafeRegExpEnvironment(context);
      return cachedUnsafeRegExpEnvironment;
    };
    return createLoopAwareVisitors(
      {
        NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
          if (isStaticRegExpConstruction(node, context, getHasUnsafeRegExpEnvironment)) {
            context.report({ node, message: MESSAGE });
          }
        },
        CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
          if (isStaticRegExpConstruction(node, context, getHasUnsafeRegExpEnvironment)) {
            context.report({ node, message: MESSAGE });
          }
        },
      },
      { treatIteratorCallbacksAsLoops: true },
    );
  },
});
