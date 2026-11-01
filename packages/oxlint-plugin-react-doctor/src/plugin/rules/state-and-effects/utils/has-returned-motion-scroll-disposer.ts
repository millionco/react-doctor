import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { resolveConstIdentifierRootSymbol } from "../../../utils/resolve-const-identifier-root-symbol.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../../utils/find-render-phase-component-or-hook.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getFiniteStaticStringValues } from "../../../utils/get-finite-static-string-values.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getRangeStart } from "../../../utils/get-range-start.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";

const MOTION_PROVIDER_MODULE_ROOTS = new Set([
  "motion",
  "framer-motion",
  "motion-dom",
  "motion-utils",
]);
const MOTION_SCROLL_RESULT_NAMES = new Set([
  "scrollX",
  "scrollY",
  "scrollXProgress",
  "scrollYProgress",
]);
const MOTION_RUNTIME_IMPORT_NAMES = new Set(["useScroll", "useMotionValue", "useTransform"]);
const MOTION_READ_METHOD_NAMES = new Set(["get", "getPrevious"]);
const MOTION_DYNAMIC_PROVIDER_NAMES = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "Proxy",
  "require",
]);
const MOTION_PROVIDER_PROPERTY_NAMES = new Set([
  ...MOTION_DYNAMIC_PROVIDER_NAMES,
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "getBuiltinModule",
]);
const MOTION_RUNTIME_TYPESCRIPT_NODES = new Set([
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSEnumDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
const motionProviderValidityByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const motionImportValidityByAnalysis = new WeakMap<ScopeAnalysis, Map<SymbolDescriptor, boolean>>();
const motionScrollCallsByAnalysis = new WeakMap<
  ScopeAnalysis,
  Map<EsTreeNode, ReadonlySet<EsTreeNode> | null>
>();

const isMotionProviderModule = (source: string): boolean =>
  [...MOTION_PROVIDER_MODULE_ROOTS].some(
    (root) => source === root || source.startsWith(`${root}/`),
  );

const isClosedRuntimeNamedImport = (
  identifier: EsTreeNode,
  source: string,
  importedName: string,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "import") return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  if (
    !declaration ||
    declaration.source.value !== source ||
    declaration.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== importedName
  )
    return false;
  const cache =
    motionImportValidityByAnalysis.get(context.scopes) ?? new Map<SymbolDescriptor, boolean>();
  motionImportValidityByAnalysis.set(context.scopes, cache);
  const cached = cache.get(symbol);
  if (cached !== undefined) return cached;
  const valid = symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const consumer = reference.identifier.parent;
    return (
      reference.flag === "read" &&
      !isWithinAssignmentTarget(reference.identifier) &&
      isNodeOfType(consumer, "CallExpression") &&
      consumer.callee === reference.identifier &&
      !consumer.optional
    );
  });
  cache.set(symbol, valid);
  return valid;
};

const hasUnresolvedMotionWriteReceiver = (
  member: EsTreeNodeOfType<"MemberExpression">,
  context: RuleContext,
): boolean => {
  if (!member.computed || !isWithinAssignmentTarget(member)) return false;
  const expression = findTransparentExpressionRoot(member);
  const consumer = expression.parent;
  if (
    !isNodeOfType(consumer, "MemberExpression") ||
    consumer.object !== expression ||
    getResolvedStaticPropertyName(member, context.scopes) !== null
  )
    return false;
  const root = getRootIdentifier(member.object);
  const symbol = root ? resolveConstIdentifierRootSymbol(root, context.scopes) : null;
  if (symbol?.kind !== "const" || !symbol.initializer) return false;
  const initialization = stripParenExpression(symbol.initializer);
  if (!isNodeOfType(initialization, "CallExpression") || initialization.optional) return false;
  return [...MOTION_RUNTIME_IMPORT_NAMES].some((name) =>
    isClosedRuntimeNamedImport(initialization.callee, "motion/react", name, context),
  );
};

const hasOrdinaryMotionProviders = (context: RuleContext): boolean => {
  const cached = motionProviderValidityByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  let valid = true;
  try {
    walkAst(context.scopes.rootScope.node, (node) => {
      if (!valid) return false;
      if (
        MOTION_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
        node.type === "WithStatement" ||
        node.type === "ImportExpression"
      ) {
        valid = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "ImportDeclaration")) {
        const source = node.source.value;
        if (source === "vm" || source === "node:vm") {
          if (
            node.importKind !== "type" &&
            node.specifiers.some(
              (specifier) =>
                !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type",
            )
          )
            valid = false;
          if (node.importKind !== "type" && !node.specifiers.length) valid = false;
        }
        if (typeof source !== "string" || !isMotionProviderModule(source)) return;
        if (node.importKind !== "type" && !node.specifiers.length) valid = false;
        for (const specifier of node.specifiers) {
          const symbol = context.scopes.symbolFor(specifier.local);
          if (
            node.importKind === "type" ||
            (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
          ) {
            if (
              symbol?.references.some(
                (reference) => !isTypeScriptTypePosition(reference.identifier),
              )
            )
              valid = false;
            continue;
          }
          const importedName = getImportedName(specifier);
          if (
            source !== "motion/react" ||
            !importedName ||
            !MOTION_RUNTIME_IMPORT_NAMES.has(importedName) ||
            !isClosedRuntimeNamedImport(specifier.local, source, importedName, context)
          )
            valid = false;
        }
      }
      if (
        (isNodeOfType(node, "ExportNamedDeclaration") ||
          isNodeOfType(node, "ExportAllDeclaration")) &&
        node.source &&
        typeof node.source.value === "string" &&
        isMotionProviderModule(node.source.value) &&
        node.exportKind !== "type"
      )
        valid = false;
      if (
        isNodeOfType(node, "Identifier") &&
        context.scopes.referenceFor(node) &&
        MOTION_DYNAMIC_PROVIDER_NAMES.has(node.name)
      )
        valid = false;
      if (
        isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
      ) {
        const name = getStaticPropertyKeyName(node, { allowComputedString: true });
        const key = isNodeOfType(node, "MemberExpression") ? node.property : node.key;
        const candidates = node.computed
          ? getFiniteStaticStringValues(key, context)
          : new Set<string>();
        if (
          (name !== null && MOTION_PROVIDER_PROPERTY_NAMES.has(name)) ||
          [...candidates].some((candidate) => MOTION_PROVIDER_PROPERTY_NAMES.has(candidate))
        )
          valid = false;
        if (
          isNodeOfType(node, "MemberExpression") &&
          (hasUnresolvedMotionWriteReceiver(node, context) ||
            (isWithinAssignmentTarget(node) &&
              (name === "on" ||
                (name !== null && MOTION_READ_METHOD_NAMES.has(name)) ||
                [...candidates].some(
                  (candidate) => candidate === "on" || MOTION_READ_METHOD_NAMES.has(candidate),
                ))))
        )
          valid = false;
      }
    });
  } catch {
    valid = false;
  }
  motionProviderValidityByAnalysis.set(context.scopes, valid);
  return valid;
};

const getMotionEffectCall = (
  callback: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length
  )
    return null;
  const effectCall = callback.parent;
  if (!isNodeOfType(effectCall, "CallExpression") || effectCall.optional) return null;
  const [effectCallback, dependencies, ...otherArguments] = effectCall.arguments;
  if (
    effectCallback !== callback ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    otherArguments.length ||
    !isClosedRuntimeNamedImport(effectCall.callee, "react", "useEffect", context)
  )
    return null;
  return effectCall;
};

const getReturnedMotionEffect = (
  registration: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  let callback = registration.parent;
  if (isNodeOfType(callback, "ReturnStatement") && callback.argument === registration) {
    const block = callback.parent;
    if (!isNodeOfType(block, "BlockStatement")) return null;
    const [statement, ...otherStatements] = block.body.filter(
      (statement) =>
        !isNodeOfType(statement, "TSInterfaceDeclaration") &&
        !isNodeOfType(statement, "TSTypeAliasDeclaration"),
    );
    if (statement !== callback || otherStatements.length) return null;
    callback = block.parent;
  }
  if (!callback || !isNodeOfType(callback, "ArrowFunctionExpression")) return null;
  if (callback.body !== registration && !isNodeOfType(callback.body, "BlockStatement")) return null;
  const effectCall = getMotionEffectCall(callback, context);
  if (!effectCall || !isNodeOfType(registration, "CallExpression") || registration.optional)
    return null;
  const [event, listener, ...otherArguments] = registration.arguments;
  if (
    otherArguments.length ||
    !isNodeOfType(event, "Literal") ||
    event.value !== "change" ||
    !isNodeOfType(listener, "ArrowFunctionExpression") ||
    listener.async ||
    !listener.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  )
    return null;
  return effectCall;
};

const collectMotionScrollCalls = (
  declaration: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): ReadonlySet<EsTreeNode> | null => {
  const initialization = declaration.init;
  const declarationStart = getRangeStart(declaration);
  if (
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !isNodeOfType(initialization, "CallExpression") ||
    initialization.optional ||
    initialization.arguments.length ||
    !isClosedRuntimeNamedImport(initialization.callee, "motion/react", "useScroll", context) ||
    declarationStart === null ||
    findRenderPhaseComponentOrHook(declaration, context.scopes) !==
      findEnclosingFunction(declaration)
  )
    return null;
  const calls = new Set<EsTreeNode>();
  const keys = new Set<string>();
  for (const property of declaration.id.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const name = property.key.name;
    if (!MOTION_SCROLL_RESULT_NAMES.has(name) || keys.has(name)) return null;
    keys.add(name);
    const symbol = context.scopes.symbolFor(property.value);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      symbol.declarationNode !== declaration ||
      symbol.bindingIdentifier !== property.value
    )
      return null;
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      if (
        property.shorthand &&
        property.key !== property.value &&
        identifier === property.key &&
        identifier.parent === property &&
        reference.flag === "read"
      )
        continue;
      if (isTypeScriptTypePosition(identifier)) continue;
      if (reference.flag !== "read" || isWithinAssignmentTarget(identifier)) return null;
      const parent = identifier.parent;
      if (isNodeOfType(parent, "ArrayExpression")) {
        const effectCall = parent.parent;
        if (
          !isNodeOfType(effectCall, "CallExpression") ||
          effectCall.optional ||
          !isClosedRuntimeNamedImport(effectCall.callee, "react", "useEffect", context)
        )
          return null;
        const [, dependencies] = effectCall.arguments;
        if (dependencies !== parent) return null;
        continue;
      }
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== identifier ||
        parent.computed ||
        parent.optional ||
        !isNodeOfType(parent.property, "Identifier")
      )
        return null;
      const call = parent.parent;
      if (!isNodeOfType(call, "CallExpression") || call.callee !== parent || call.optional)
        return null;
      if (MOTION_READ_METHOD_NAMES.has(parent.property.name) && !call.arguments.length) continue;
      if (name !== "scrollY" || parent.property.name !== "on") return null;
      const effectCall = getReturnedMotionEffect(call, context);
      const effectStart = effectCall ? getRangeStart(effectCall) : null;
      if (
        !effectCall ||
        effectStart === null ||
        declarationStart >= effectStart ||
        findEnclosingFunction(effectCall) !== findEnclosingFunction(declaration)
      )
        return null;
      calls.add(call);
    }
  }
  return keys.has("scrollY") ? calls : null;
};

export const hasReturnedMotionScrollDisposer = (
  callback: EsTreeNode,
  registration: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(registration, "CallExpression") ||
    !isNodeOfType(registration.callee, "MemberExpression")
  )
    return false;
  const receiver = registration.callee.object;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  const effectCall = getMotionEffectCall(callback, context);
  if (
    !effectCall ||
    getReturnedMotionEffect(registration, context) !== effectCall ||
    !hasOrdinaryMotionProviders(context)
  )
    return false;
  const cache =
    motionScrollCallsByAnalysis.get(context.scopes) ??
    new Map<EsTreeNode, ReadonlySet<EsTreeNode> | null>();
  motionScrollCallsByAnalysis.set(context.scopes, cache);
  const declaration = symbol.declarationNode;
  if (!cache.has(declaration))
    cache.set(declaration, collectMotionScrollCalls(declaration, context));
  return cache.get(declaration)?.has(registration) ?? false;
};
