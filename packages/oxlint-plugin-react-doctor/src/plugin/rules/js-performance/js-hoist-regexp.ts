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
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import type { ScopeDescriptor } from "../../semantic/scope-analysis.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const isStaticPattern = (argument: EsTreeNode | null | undefined): boolean => {
  if (!argument) return false;
  const unwrappedArgument = stripParenExpression(argument);
  return (
    isNodeOfType(unwrappedArgument, "Literal") ||
    (isNodeOfType(unwrappedArgument, "TemplateLiteral") &&
      (unwrappedArgument.expressions?.length ?? 0) === 0)
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
  if (isNodeOfType(unwrappedArgument, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(unwrappedArgument);
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
    isGlobSyncImport =
      context.scopes.symbolFor(callee)?.kind === "import" &&
      getImportedNameFromModule(callee, callee.name, "glob") === "globSync";
  } else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "globSync"
  ) {
    isGlobSyncImport =
      context.scopes.symbolFor(callee.object)?.kind === "import" &&
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
    return GLOBAL_BUILTIN_NAMES.has(propertyName) ? propertyName : null;
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
    if (context.scopes.isGlobalReference(unwrappedNode)) {
      if (GLOBAL_OBJECT_NAMES.has(unwrappedNode.name)) return "global";
      return GLOBAL_BUILTIN_NAMES.has(unwrappedNode.name) ? unwrappedNode.name : null;
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

type RegExpEnvironmentHazard = "none" | "replaceAllIntegrityLost" | "globalRegExpReplaced";

const strongerRegExpEnvironmentHazard = (
  first: RegExpEnvironmentHazard,
  second: RegExpEnvironmentHazard,
): RegExpEnvironmentHazard => {
  if (first === "globalRegExpReplaced" || second === "globalRegExpReplaced") {
    return "globalRegExpReplaced";
  }
  if (first === "replaceAllIntegrityLost" || second === "replaceAllIntegrityLost") {
    return "replaceAllIntegrityLost";
  }
  return "none";
};

const getAssignmentTargetRegExpHazard = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): RegExpEnvironmentHazard => {
  if (!node) return "none";
  const target = stripParenExpression(node);
  if (isNodeOfType(target, "MemberExpression")) {
    const objectPath = getGlobalPath(target.object, context, symbolCache);
    const propertyName = getStaticPropertyName(target);
    if (objectPath === "global") {
      return propertyName === null || propertyName === "RegExp" ? "globalRegExpReplaced" : "none";
    }
    if (objectPath === REGEXP_PROTOTYPE_PATH) return "replaceAllIntegrityLost";
    return objectPath === STRING_PROTOTYPE_PATH &&
      (propertyName === null || propertyName === "replaceAll")
      ? "replaceAllIntegrityLost"
      : "none";
  }
  if (isNodeOfType(target, "AssignmentPattern")) {
    return getAssignmentTargetRegExpHazard(target.left, context, symbolCache);
  }
  if (isNodeOfType(target, "RestElement")) {
    return getAssignmentTargetRegExpHazard(target.argument, context, symbolCache);
  }
  if (isNodeOfType(target, "ArrayPattern")) {
    return target.elements.reduce<RegExpEnvironmentHazard>(
      (strongest, element) =>
        strongerRegExpEnvironmentHazard(
          strongest,
          getAssignmentTargetRegExpHazard(element, context, symbolCache),
        ),
      "none",
    );
  }
  if (isNodeOfType(target, "ObjectPattern")) {
    return target.properties.reduce<RegExpEnvironmentHazard>(
      (strongest, property) =>
        strongerRegExpEnvironmentHazard(
          strongest,
          getAssignmentTargetRegExpHazard(
            isNodeOfType(property, "Property") ? property.value : property,
            context,
            symbolCache,
          ),
        ),
      "none",
    );
  }
  return "none";
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

const getCallRegExpHazard = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  symbolCache: Map<number, string | false>,
): RegExpEnvironmentHazard => {
  const methodName = getGlobalPath(node.callee, context, symbolCache);
  const target = node.arguments?.[0];
  if (!target) return "none";
  const targetPath = getGlobalPath(target, context, symbolCache);
  const isSinglePropertyMutation =
    methodName === "Object.defineProperty" ||
    methodName === "Reflect.set" ||
    methodName === "Reflect.defineProperty" ||
    methodName === "Reflect.deleteProperty";
  const isPropertyCollectionMutation =
    methodName === "Object.defineProperties" || methodName === "Object.assign";
  if (targetPath === REGEXP_PROTOTYPE_PATH) {
    return isSinglePropertyMutation ||
      isPropertyCollectionMutation ||
      methodName === "Object.setPrototypeOf" ||
      methodName === "Reflect.setPrototypeOf"
      ? "replaceAllIntegrityLost"
      : "none";
  }
  if (targetPath !== STRING_PROTOTYPE_PATH && targetPath !== "global") return "none";
  const mutationHazard: RegExpEnvironmentHazard =
    targetPath === "global" ? "globalRegExpReplaced" : "replaceAllIntegrityLost";
  const guardedPropertyName = targetPath === "global" ? "RegExp" : "replaceAll";
  if (isSinglePropertyMutation) {
    const propertyName = getStaticStringValue(node.arguments?.[1]);
    return propertyName === null || propertyName === guardedPropertyName ? mutationHazard : "none";
  }
  if (!isPropertyCollectionMutation) return "none";
  const definitionSources =
    methodName === "Object.defineProperties" && targetPath === "global"
      ? [node.arguments?.[1]]
      : (node.arguments?.slice(1) ?? []);
  return definitionSources.some((source) =>
    objectExpressionMayDefineProperty(source, guardedPropertyName),
  )
    ? mutationHazard
    : "none";
};

const scopeTreeWritesGlobalRegExp = (scope: ScopeDescriptor): boolean =>
  scope.references.some(
    (reference) =>
      reference.resolvedSymbol === null &&
      reference.flag !== "read" &&
      isNodeOfType(reference.identifier, "Identifier") &&
      reference.identifier.name === "RegExp",
  ) || scope.children.some(scopeTreeWritesGlobalRegExp);

const scanRegExpEnvironmentHazard = (context: RuleContext): RegExpEnvironmentHazard => {
  if (scopeTreeWritesGlobalRegExp(context.scopes.rootScope)) return "globalRegExpReplaced";
  let strongestHazard: RegExpEnvironmentHazard = "none";
  const symbolCache = new Map<number, string | false>();
  walkAst(context.scopes.rootScope.node, (node: EsTreeNode): boolean | void => {
    if (strongestHazard === "globalRegExpReplaced") return false;
    const writeTarget = getWriteTarget(node);
    const nodeHazard = writeTarget
      ? getAssignmentTargetRegExpHazard(writeTarget, context, symbolCache)
      : isNodeOfType(node, "CallExpression")
        ? getCallRegExpHazard(node, context, symbolCache)
        : "none";
    strongestHazard = strongerRegExpEnvironmentHazard(strongestHazard, nodeHazard);
    if (strongestHazard === "globalRegExpReplaced") return false;
  });
  return strongestHazard;
};

// `RegExp(...)` without `new` constructs a fresh regex exactly like
// `new RegExp(...)` does, so both call forms get the same treatment.
const getHoistableRegExpConstructionKind = (
  node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): "stateless" | "statefulReplaceAll" | null => {
  const patternArgument = node.arguments?.[0] as EsTreeNode | undefined;
  const flagsArgument = node.arguments?.[1] as EsTreeNode | undefined;
  const callee = stripParenExpression(node.callee);
  const effectiveFlags = getEffectiveRegExpFlags(patternArgument, flagsArgument);
  if (
    !isNodeOfType(callee, "Identifier") ||
    callee.name !== "RegExp" ||
    !context.scopes.isGlobalReference(callee) ||
    !isStaticPattern(patternArgument) ||
    effectiveFlags === null ||
    !hasValidRegExpFlags(effectiveFlags)
  ) {
    return null;
  }
  if (!STATEFUL_REGEXP_FLAGS_PATTERN.test(effectiveFlags)) return "stateless";
  return isSafeStatefulReplaceAllSearch(node, effectiveFlags, context)
    ? "statefulReplaceAll"
    : null;
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
    let cachedEnvironmentHazard: RegExpEnvironmentHazard | null = null;
    const reportHoistableRegExpConstruction = (
      node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
    ): void => {
      const constructionKind = getHoistableRegExpConstructionKind(node, context);
      if (constructionKind === null) return;
      cachedEnvironmentHazard ??= scanRegExpEnvironmentHazard(context);
      if (cachedEnvironmentHazard === "globalRegExpReplaced") return;
      if (
        constructionKind === "statefulReplaceAll" &&
        cachedEnvironmentHazard === "replaceAllIntegrityLost"
      ) {
        return;
      }
      context.report({ node, message: MESSAGE });
    };
    return createLoopAwareVisitors(
      {
        NewExpression: reportHoistableRegExpConstruction,
        CallExpression: reportHoistableRegExpConstruction,
      },
      { treatIteratorCallbacksAsLoops: true },
    );
  },
});
