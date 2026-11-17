import { closureCaptures } from "../semantic/closure-captures.js";
import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface LiteralIndexDependencyInput {
  callback: EsTreeNode;
  dependencies: EsTreeNodeOfType<"ArrayExpression">;
  missingCaptureKeys: ReadonlyArray<string>;
  scopes: ScopeAnalysis;
}

const hasOpaqueScopeCache = new WeakMap<EsTreeNode, boolean>();
const symbolSupportByAnalysis = new WeakMap<ScopeAnalysis, WeakMap<SymbolDescriptor, boolean>>();

const getLiteralIndexRead = (identifier: EsTreeNode): number | null => {
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const member = referenceRoot.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== referenceRoot ||
    !member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Literal") ||
    typeof member.property.value !== "number" ||
    !Number.isSafeInteger(member.property.value) ||
    member.property.value < 0 ||
    isWithinAssignmentTarget(member)
  ) {
    return null;
  }
  const memberRoot = findTransparentExpressionRoot(member);
  const consumer = memberRoot.parent;
  if (
    (isNodeOfType(consumer, "MemberExpression") && consumer.object === memberRoot) ||
    ((isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
      consumer.callee === memberRoot) ||
    (isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === memberRoot)
  ) {
    return null;
  }
  return member.property.value;
};

const hasSupportedIndexProvider = (symbol: SymbolDescriptor, owner: EsTreeNode): boolean => {
  if (symbol.kind === "parameter") {
    const binding = symbol.bindingIdentifier;
    if (binding.parent === owner) return true;
    const property = binding.parent;
    const pattern = property?.parent;
    return Boolean(
      isNodeOfType(property, "Property") &&
      !property.computed &&
      property.value === binding &&
      isNodeOfType(pattern, "ObjectPattern") &&
      pattern.parent === owner,
    );
  }
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !symbol.initializer
  ) {
    return false;
  }
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "ArrayExpression") &&
    initializer.elements.every((element) => element && !isNodeOfType(element, "SpreadElement"))
  );
};

const isSupportedLiteralIndexSymbol = (symbol: SymbolDescriptor): boolean => {
  const owner = findEnclosingFunction(symbol.bindingIdentifier);
  if (!owner || !hasSupportedIndexProvider(symbol, owner)) return false;
  let hasOpaqueScope = hasOpaqueScopeCache.get(owner);
  if (hasOpaqueScope === undefined) {
    hasOpaqueScope = false;
    walkAst(owner, (node) => {
      const callee = isNodeOfType(node, "CallExpression")
        ? stripParenExpression(node.callee)
        : null;
      if (
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && node.name === "arguments") ||
        (isNodeOfType(callee, "Identifier") && callee.name === "eval")
      ) {
        hasOpaqueScope = true;
        return false;
      }
    });
    hasOpaqueScopeCache.set(owner, hasOpaqueScope);
  }
  return (
    !hasOpaqueScope &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" && getLiteralIndexRead(reference.identifier) !== null,
    )
  );
};

export const findLiteralIndexDependencyCoverage = ({
  callback,
  dependencies,
  missingCaptureKeys,
  scopes,
}: LiteralIndexDependencyInput): ReadonlySet<string> => {
  const coveredRoots = new Set<string>();
  if (missingCaptureKeys.length === 0) return coveredRoots;
  const missingNames = new Set(missingCaptureKeys);
  const declaredIndexesBySymbol = new Map<SymbolDescriptor, Set<number>>();
  for (const dependency of dependencies.elements) {
    if (!dependency || isNodeOfType(dependency, "SpreadElement")) return coveredRoots;
    const member = stripParenExpression(dependency);
    if (!isNodeOfType(member, "MemberExpression")) continue;
    const identifier = stripParenExpression(member.object);
    if (!isNodeOfType(identifier, "Identifier") || !missingNames.has(identifier.name)) continue;
    const index = getLiteralIndexRead(identifier);
    const symbol = scopes.symbolFor(identifier);
    if (index === null || !symbol) continue;
    const declaredIndexes = declaredIndexesBySymbol.get(symbol) ?? new Set<number>();
    declaredIndexes.add(index);
    declaredIndexesBySymbol.set(symbol, declaredIndexes);
  }
  if (declaredIndexesBySymbol.size === 0) return coveredRoots;
  const capturesBySymbol = new Map<SymbolDescriptor, ReferenceDescriptor[]>();
  const symbolsByName = new Map<string, SymbolDescriptor>();
  const ambiguousNames = new Set<string>();
  for (const reference of closureCaptures(callback, scopes)) {
    const symbol = reference.resolvedSymbol;
    if (!symbol || !missingNames.has(symbol.name)) continue;
    const previousSymbol = symbolsByName.get(symbol.name);
    if (previousSymbol && previousSymbol !== symbol) ambiguousNames.add(symbol.name);
    symbolsByName.set(symbol.name, symbol);
    if (!declaredIndexesBySymbol.has(symbol)) continue;
    const captures = capturesBySymbol.get(symbol) ?? [];
    captures.push(reference);
    capturesBySymbol.set(symbol, captures);
  }
  let symbolSupport = symbolSupportByAnalysis.get(scopes);
  if (!symbolSupport) {
    symbolSupport = new WeakMap();
    symbolSupportByAnalysis.set(scopes, symbolSupport);
  }
  for (const [symbol, captures] of capturesBySymbol) {
    if (ambiguousNames.has(symbol.name)) continue;
    let isSupported = symbolSupport.get(symbol);
    if (isSupported === undefined) {
      isSupported = isSupportedLiteralIndexSymbol(symbol);
      symbolSupport.set(symbol, isSupported);
    }
    if (!isSupported) continue;
    const declaredIndexes = declaredIndexesBySymbol.get(symbol);
    if (!declaredIndexes) continue;
    const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
    if (
      captures.every((reference) => {
        const index = getLiteralIndexRead(reference.identifier);
        return (
          findEnclosingFunction(reference.identifier) === callback &&
          index !== null &&
          declaredIndexes.has(index) &&
          (!isNodeOfType(initializer, "ArrayExpression") || Boolean(initializer.elements[index]))
        );
      })
    ) {
      coveredRoots.add(symbol.name);
    }
  }
  return coveredRoots;
};
