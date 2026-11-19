import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getRuntimeStaticDependencySource } from "../../utils/get-runtime-static-dependency-source.js";
import { getResolvedStaticPropertyName } from "../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../utils/has-static-property-write-before.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { resolveModulePath } from "../../utils/resolve-module-path.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MODULE_LOADER_SOURCES: ReadonlySet<string> = new Set([
  "module",
  "node:module",
  "vm",
  "node:vm",
]);

const hasReactProviderHazardByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasReactProviderHazard = (scopes: ScopeAnalysis): boolean => {
  const cached = hasReactProviderHazardByScope.get(scopes);
  if (cached !== undefined) return cached;
  let found = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (found) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "require" &&
        scopes.isGlobalReference(node))
    ) {
      found = true;
      return false;
    }
    const source = getRuntimeStaticDependencySource(node);
    if (
      source !== null &&
      (MODULE_LOADER_SOURCES.has(source) ||
        /(?:^|[/\\])node_modules[/\\]react(?:[/\\]|$)/.test(source) ||
        (source === "react" && !isNodeOfType(node, "ImportDeclaration")))
    ) {
      found = true;
      return false;
    }
    if (
      isNodeOfType(node, "ExportSpecifier") &&
      node.exportKind !== "type" &&
      isNodeOfType(node.local, "Identifier") &&
      resolveImportedApiReference(node.local, scopes)?.source === "react"
    ) {
      found = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const symbol = scopes.symbolFor(node);
    if (symbol?.bindingIdentifier !== node || symbol.kind !== "import") return;
    const api = resolveImportedApiReference(node, scopes);
    if (
      api?.source === "react" &&
      (api.isNamespace || api.importedName === "default") &&
      symbol.references.length > 0
    ) {
      found = true;
      return false;
    }
  });
  hasReactProviderHazardByScope.set(scopes, found);
  return found;
};

const isDirectNamedReactCall = (
  call: EsTreeNode | null | undefined,
  name: "useEffect" | "useRef",
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isNodeOfType(scopes.symbolFor(call.callee)?.declarationNode, "ImportSpecifier")
  ) {
    return false;
  }
  const api = resolveImportedApiReference(call.callee, scopes);
  return api?.source === "react" && api.importedName === name;
};

const isInlineReactEffectCallback = (callback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const root = findTransparentExpressionRoot(callback);
  const call = root.parent;
  return (
    isNodeOfType(call, "CallExpression") &&
    call.arguments[0] === root &&
    isDirectNamedReactCall(call, "useEffect", scopes)
  );
};

const getInlineRefSeed = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): EsTreeNode | null => {
  const initializer = getDirectConstInitializer(symbol);
  if (!initializer || !isSymbolReadOnly(symbol)) return null;
  const member = stripParenExpression(initializer);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    getStaticPropertyName(member) !== "current"
  ) {
    return null;
  }
  const refCall = stripParenExpression(member.object);
  if (
    !isNodeOfType(refCall, "CallExpression") ||
    !isDirectNamedReactCall(refCall, "useRef", scopes) ||
    refCall.arguments.length !== 1 ||
    isNodeOfType(refCall.arguments[0], "SpreadElement")
  ) {
    return null;
  }
  return hasReactProviderHazard(scopes) ? null : stripParenExpression(refCall.arguments[0]);
};

const getDirectMethodReceiver = (
  node: EsTreeNode | null | undefined,
  name: string,
): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
  const callee = node.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    getStaticPropertyName(callee) !== name
  ) {
    return null;
  }
  return callee.object;
};

const getDirectArrayIteration = (node: EsTreeNode | null | undefined) => {
  if (!isNodeOfType(node, "CallExpression") || node.arguments.length !== 1) return null;
  const callback = node.arguments[0];
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length > 2 ||
    !callback.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  ) {
    return null;
  }
  const mapReceiver = getDirectMethodReceiver(node, "map");
  if (mapReceiver) return { receiver: mapReceiver, callback, methodName: "map" };
  const forEachReceiver = getDirectMethodReceiver(node, "forEach");
  return forEachReceiver ? { receiver: forEachReceiver, callback, methodName: "forEach" } : null;
};

const hasStockArraySeed = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const seed = getInlineRefSeed(symbol, scopes);
  const mapped = seed ? getDirectArrayIteration(seed) : null;
  if (!mapped || mapped.methodName !== "map") return false;
  const fillCall = mapped.receiver;
  if (!isNodeOfType(fillCall, "CallExpression") || fillCall.arguments.length !== 1) return false;
  const arrayCall = getDirectMethodReceiver(fillCall, "fill");
  return (
    isNodeOfType(arrayCall, "CallExpression") &&
    !arrayCall.optional &&
    arrayCall.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement")) &&
    isNodeOfType(arrayCall.callee, "Identifier") &&
    arrayCall.callee.name === "Array" &&
    isProvenUnmodifiedGlobalNamespaceReference(arrayCall.callee, "Array", scopes, undefined, true)
  );
};

const isNumericArraySlot = (
  key: EsTreeNode,
  array: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(key, "Literal") && typeof key.value === "number") {
    return Number.isInteger(key.value) && key.value >= 0;
  }
  if (!isNodeOfType(key, "Identifier")) return false;
  const index = scopes.symbolFor(key);
  if (!index || !isSymbolReadOnly(index)) return false;
  const owner = findEnclosingFunction(index.bindingIdentifier);
  const iteration = getDirectArrayIteration(owner?.parent);
  if (
    !iteration ||
    iteration.callback !== owner ||
    iteration.callback.params[1] !== index.bindingIdentifier ||
    !isNodeOfType(iteration.receiver, "Identifier")
  ) {
    return false;
  }
  const receiver = scopes.symbolFor(iteration.receiver);
  return Boolean(
    receiver &&
    (receiver === array ||
      (hasStockArraySeed(receiver, scopes) &&
        !hasPossibleStaticPropertyMutationOrEscape(
          iteration.receiver,
          iteration.methodName,
          scopes,
        ))),
  );
};

const hasClosedArrayMethodUses = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  writerOwner?: EsTreeNode,
): boolean =>
  symbol.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== root || member.optional) {
      return false;
    }
    const memberRoot = findTransparentExpressionRoot(member);
    const consumer = memberRoot.parent;
    if (!member.computed) {
      const iteration = getDirectArrayIteration(consumer);
      return iteration !== null && iteration.receiver === root;
    }
    if (!isNumericArraySlot(stripParenExpression(member.property), symbol, scopes)) return false;
    if (!isWithinAssignmentTarget(memberRoot)) return true;
    return (
      isNodeOfType(consumer, "AssignmentExpression") &&
      consumer.left === memberRoot &&
      consumer.operator === "=" &&
      (!writerOwner || isAstDescendant(memberRoot, writerOwner))
    );
  });

const REFLECTIVE_PROVIDER_NAMES: ReadonlySet<string> = new Set([
  "Object",
  "Reflect",
  "Function",
  "eval",
]);

const PROTOTYPE_ACCESS_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "constructor",
  "prototype",
  "getPrototypeOf",
  "setPrototypeOf",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

const arrayProviderExposureByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasArrayProviderExposure = (scopes: ScopeAnalysis): boolean => {
  const cached = arrayProviderExposureByScope.get(scopes);
  if (cached !== undefined) return cached;
  let found = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (found) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      REFLECTIVE_PROVIDER_NAMES.has(node.name) &&
      scopes.isGlobalReference(node)
    ) {
      found = true;
      return false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      isProvenGlobalNamespaceReference(node, "Array", scopes)
    ) {
      found =
        !isNodeOfType(node.parent, "CallExpression") ||
        node.parent.callee !== node ||
        node.parent.optional;
      return;
    }
    if (
      !isNodeOfType(node, "MemberExpression") &&
      !isNodeOfType(node, "Property") &&
      !isNodeOfType(node, "MethodDefinition") &&
      !isNodeOfType(node, "PropertyDefinition")
    ) {
      return;
    }
    const key = getResolvedStaticPropertyName(node, scopes, {
      allowConstNumericLiteral: true,
      allowConstTemplateLiteral: true,
      stringifyNonStringLiterals: true,
    });
    if (key !== null) {
      found = PROTOTYPE_ACCESS_NAMES.has(key) || REFLECTIVE_PROVIDER_NAMES.has(key);
      return;
    }
    if (!node.computed) return;
    // Only verified slots on a closed inline-ref array can have a dynamic key.
    const receiver =
      isNodeOfType(node, "MemberExpression") &&
      !node.optional &&
      isNodeOfType(node.object, "Identifier")
        ? scopes.symbolFor(node.object)
        : null;
    found =
      !receiver ||
      !isNodeOfType(node, "MemberExpression") ||
      !hasStockArraySeed(receiver, scopes) ||
      !hasCompleteSymbolReferences(receiver, scopes.rootScope.node, scopes) ||
      !isNumericArraySlot(stripParenExpression(node.property), receiver, scopes) ||
      !hasClosedArrayMethodUses(receiver, scopes);
  });
  arrayProviderExposureByScope.set(scopes, found);
  return found;
};

export const isStableInlineRefCurrentCapture = (
  reference: ReferenceDescriptor,
  symbol: SymbolDescriptor,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  const root = findTransparentExpressionRoot(reference.identifier);
  const member = root.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== root ||
    member.optional ||
    !filename ||
    !isInlineReactEffectCallback(callback, scopes) ||
    !hasStockArraySeed(symbol, scopes) ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  const memberRoot = findTransparentExpressionRoot(member);
  const consumer = memberRoot.parent;
  if (member.computed) {
    if (
      !isNodeOfType(consumer, "AssignmentExpression") ||
      consumer.left !== memberRoot ||
      consumer.operator !== "=" ||
      !isNumericArraySlot(stripParenExpression(member.property), symbol, scopes)
    ) {
      return false;
    }
  } else if (getDirectArrayIteration(consumer)?.receiver !== root) {
    return false;
  }
  // Identity alone does not make a read from a mutable value stable. Only
  // known stock array methods and writes to numeric slots qualify here.
  return (
    !hasArrayProviderExposure(scopes) &&
    hasClosedArrayMethodUses(symbol, scopes, callback) &&
    !resolveModulePath(filename, "react")
  );
};
