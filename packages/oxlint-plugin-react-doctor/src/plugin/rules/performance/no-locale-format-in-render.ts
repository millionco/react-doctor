import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { hasClientRenderEvidence } from "../../utils/has-client-render-evidence.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { hasSuppressHydrationWarningAttribute } from "../../utils/has-suppress-hydration-warning-attribute.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAfterClientOnlyEarlyReturn } from "../../utils/is-after-client-only-early-return.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// `toLocaleString` also lives on Number/BigInt (grouping separators differ
// by locale, so those mismatch too); the Date/Time variants are Date-only.
const LOCALE_FORMAT_METHOD_NAMES = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
]);

const DATE_ONLY_LOCALE_METHOD_NAMES = new Set(["toLocaleDateString", "toLocaleTimeString"]);

// `NumberFormat` is deliberately absent — like bare `toLocaleString()` on a
// number, its only environment input is the ICU locale (grouping/decimal
// separators), a far weaker mismatch signal than the timezone shift every
// date formatter carries. Corpus evidence: every `Intl.NumberFormat()`
// render hit was a client-fetched dashboard count that never appears in
// server HTML.
const INTL_FORMATTER_NAMES = new Set(["DateTimeFormat", "RelativeTimeFormat"]);

const INTL_FORMAT_METHOD_NAMES = new Set(["format", "formatToParts", "formatRange"]);

interface LocaleFormatMatch {
  readonly node: EsTreeNode;
  readonly display: string;
}

interface ObjectPropertyProof {
  readonly status: "absent" | "present" | "undefined" | "unknown";
}

interface SimpleAlias {
  readonly symbol: SymbolDescriptor;
  readonly readNode: EsTreeNode;
}

interface MethodOwner {
  readonly methodName: string;
  readonly ownerKind: "class" | "object";
  readonly ownerSymbol: SymbolDescriptor;
  readonly isStatic: boolean;
}

const ABSENT_PROPERTY_PROOF: ObjectPropertyProof = { status: "absent" };
const PRESENT_PROPERTY_PROOF: ObjectPropertyProof = { status: "present" };
const UNDEFINED_PROPERTY_PROOF: ObjectPropertyProof = { status: "undefined" };
const UNKNOWN_PROPERTY_PROOF: ObjectPropertyProof = { status: "unknown" };
const READ_ONLY_OBJECT_METHOD_NAMES = new Set([
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);

const isProvableDateExpression = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  const unwrapped = stripParenExpression(expression);
  return (
    isNodeOfType(unwrapped, "NewExpression") &&
    isNodeOfType(unwrapped.callee, "Identifier") &&
    unwrapped.callee.name === "Date"
  );
};

// `count.toLocaleString()` on a number only mismatches when the server's
// ICU locale differs from the user's — real but far weaker than the
// timezone shift every date formatting carries (observed to be ~75% of
// corpus hits, almost all client-fetched dashboard numbers). Bare
// `toLocaleString()` therefore needs a date-shaped receiver: a provable
// `new Date(…)` or a date-flavored name (`createdAt`, `deadline`, …).
const DATE_FLAVORED_NAME_PATTERN =
  /(date|time|timestamp|deadline|created|updated|scheduled|expire|moment|when|birthday|dob)|(at)$/i;

const receiverNameLooksDateFlavored = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Identifier")) {
    return DATE_FLAVORED_NAME_PATTERN.test(unwrapped.name);
  }
  if (isNodeOfType(unwrapped, "MemberExpression") && !unwrapped.computed) {
    return (
      isNodeOfType(unwrapped.property, "Identifier") &&
      DATE_FLAVORED_NAME_PATTERN.test(unwrapped.property.name)
    );
  }
  if (isNodeOfType(unwrapped, "CallExpression")) {
    // `row.getCreatedAt().toLocaleString()` / `parseDate(x).toLocaleString()`
    return receiverNameLooksDateFlavored(unwrapped.callee);
  }
  return false;
};

const isStaticUndefined = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  if (expression.name === "undefined" && scopes.isGlobalReference(expression)) return true;
  const symbol = scopes.symbolFor(expression);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(symbol.declarationNode.id, "Identifier") ||
    visitedSymbolIds.has(symbol.id)
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isStaticUndefined(symbol.initializer, scopes, visitedSymbolIds);
};

const isNestedAssignmentTarget = (expression: EsTreeNode): boolean => {
  let target = expression;
  let parent = target.parent;
  while (parent) {
    if (isNodeOfType(parent, "AssignmentExpression")) return parent.left === target;
    if (isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) {
      return parent.left === target;
    }
    if (isNodeOfType(parent, "AssignmentPattern")) {
      if (parent.left !== target) return false;
    } else if (isNodeOfType(parent, "RestElement")) {
      if (parent.argument !== target) return false;
    } else if (isNodeOfType(parent, "ArrayPattern")) {
      if (!parent.elements?.some((element) => element === target)) return false;
    } else if (isNodeOfType(parent, "Property")) {
      if (parent.value !== target || !isNodeOfType(parent.parent, "ObjectPattern")) return false;
    } else if (isNodeOfType(parent, "ObjectPattern")) {
      if (!parent.properties?.some((property) => property === target)) return false;
    } else {
      return false;
    }
    target = parent;
    parent = target.parent;
  }
  return false;
};

const isPotentialMutationReference = (identifier: EsTreeNode, readNode: EsTreeNode): boolean => {
  let expression: EsTreeNode = identifier;
  let parent = expression.parent;
  while (
    parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
    "expression" in parent &&
    parent.expression === expression
  ) {
    expression = parent;
    parent = expression.parent;
  }
  const rootExpression = expression;
  let memberDepth = 0;
  while (parent && isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
    memberDepth += 1;
    expression = parent;
    parent = expression.parent;
    while (
      parent &&
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
      "expression" in parent &&
      parent.expression === expression
    ) {
      expression = parent;
      parent = expression.parent;
    }
  }
  if (!parent || isAstDescendant(identifier, readNode)) return false;
  if (isNestedAssignmentTarget(expression)) return true;
  if (isNodeOfType(parent, "AssignmentExpression") && parent.left === expression) return true;
  if (isNodeOfType(parent, "UpdateExpression") && parent.argument === expression) return true;
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "delete" &&
    parent.argument === expression
  ) {
    return true;
  }
  if (isNodeOfType(parent, "CallExpression")) {
    if (parent.callee === expression) {
      if (memberDepth === 0) return true;
      const memberExpression = stripParenExpression(expression);
      return (
        memberDepth === 1 &&
        isNodeOfType(memberExpression, "MemberExpression") &&
        !READ_ONLY_OBJECT_METHOD_NAMES.has(getStaticPropertyName(memberExpression) ?? "")
      );
    }
    return memberDepth === 0 && parent.arguments?.some((argument) => argument === rootExpression);
  }
  if (isNodeOfType(parent, "NewExpression")) {
    return memberDepth === 0 && parent.arguments?.some((argument) => argument === rootExpression);
  }
  if (isNodeOfType(parent, "AssignmentExpression") && parent.right === rootExpression) {
    return true;
  }
  return false;
};

const getSimpleAlias = (identifier: EsTreeNode, scopes: ScopeAnalysis): SimpleAlias | null => {
  let expression = identifier;
  let parent = expression.parent;
  while (
    parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
    "expression" in parent &&
    parent.expression === expression
  ) {
    expression = parent;
    parent = expression.parent;
  }
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== expression ||
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(parent.id);
  return symbol ? { symbol, readNode: parent.id } : null;
};

const getDirectCallForExpression = (expression: EsTreeNode): EsTreeNode | null => {
  let callee: EsTreeNode = expression;
  let parent = callee.parent;
  while (
    parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
    "expression" in parent &&
    parent.expression === callee
  ) {
    callee = parent;
    parent = callee.parent;
  }
  return isNodeOfType(parent, "CallExpression") && parent.callee === callee ? parent : null;
};

const getMethodOwner = (functionNode: EsTreeNode, scopes: ScopeAnalysis): MethodOwner | null => {
  const methodNode = functionNode.parent;
  if (
    isNodeOfType(methodNode, "Property") &&
    methodNode.value === functionNode &&
    isNodeOfType(methodNode.parent, "ObjectExpression")
  ) {
    const objectParent = methodNode.parent.parent;
    if (
      !isNodeOfType(objectParent, "VariableDeclarator") ||
      objectParent.init !== methodNode.parent ||
      !isNodeOfType(objectParent.id, "Identifier")
    ) {
      return null;
    }
    const ownerSymbol = scopes.symbolFor(objectParent.id);
    const methodName = getStaticPropertyKeyName(methodNode, { allowComputedString: true });
    return ownerSymbol && methodName
      ? { methodName, ownerKind: "object", ownerSymbol, isStatic: false }
      : null;
  }
  if (
    !isNodeOfType(methodNode, "MethodDefinition") ||
    methodNode.value !== functionNode ||
    !isNodeOfType(methodNode.parent, "ClassBody")
  ) {
    return null;
  }
  const classNode = methodNode.parent.parent;
  if (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) {
    return null;
  }
  let bindingIdentifier = isNodeOfType(classNode.id, "Identifier") ? classNode.id : null;
  if (!bindingIdentifier && isNodeOfType(classNode.parent, "VariableDeclarator")) {
    bindingIdentifier = isNodeOfType(classNode.parent.id, "Identifier")
      ? classNode.parent.id
      : null;
  }
  if (!bindingIdentifier) return null;
  const ownerSymbol = scopes.symbolFor(bindingIdentifier);
  const methodName = getStaticPropertyKeyName(methodNode, { allowComputedString: true });
  return ownerSymbol && methodName
    ? {
        methodName,
        ownerKind: "class",
        ownerSymbol,
        isStatic: Boolean(methodNode.static),
      }
    : null;
};

const doesSymbolResolveToOwner = (
  symbol: SymbolDescriptor | null,
  ownerSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!symbol) return false;
  if (symbol.declarationNode === ownerSymbol.declarationNode) return true;
  if (symbol.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "Identifier") &&
    doesSymbolResolveToOwner(scopes.symbolFor(initializer), ownerSymbol, scopes, visitedSymbolIds)
  );
};

const isClassInstanceExpression = (
  expression: EsTreeNode,
  ownerSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression") && isNodeOfType(candidate.callee, "Identifier")) {
    return doesSymbolResolveToOwner(scopes.symbolFor(candidate.callee), ownerSymbol, scopes);
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isClassInstanceExpression(symbol.initializer, ownerSymbol, scopes, visitedSymbolIds);
};

const getMethodCalls = (functionNode: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode[] => {
  const owner = getMethodOwner(functionNode, scopes);
  if (!owner) return [];
  const calls: EsTreeNode[] = [];
  walkAst(scopes.rootScope.node, (child) => {
    if (!isNodeOfType(child, "MemberExpression")) return;
    if (getStaticPropertyName(child) !== owner.methodName) return;
    const receiver = stripParenExpression(child.object);
    let doesReceiverMatch =
      isNodeOfType(receiver, "Identifier") &&
      doesSymbolResolveToOwner(scopes.symbolFor(receiver), owner.ownerSymbol, scopes);
    if (owner.ownerKind === "class" && !owner.isStatic) {
      doesReceiverMatch = isClassInstanceExpression(receiver, owner.ownerSymbol, scopes);
    }
    if (!doesReceiverMatch) return;
    const call = getDirectCallForExpression(child);
    if (call) calls.push(call);
  });
  return calls;
};

const isFunctionInvokedBeforeUsage = (
  functionNode: EsTreeNode,
  usageNode: EsTreeNode,
  usageBoundary: number,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
  visitedFunctionNodes: Set<EsTreeNode> = new Set(),
): boolean => {
  if (visitedFunctionNodes.has(functionNode)) return false;
  visitedFunctionNodes.add(functionNode);
  const usageFunction = findEnclosingFunction(usageNode);
  const immediateCall = getDirectCallForExpression(functionNode);
  if (immediateCall) {
    const immediateCallFunction = findEnclosingFunction(immediateCall);
    if (immediateCallFunction === usageFunction) {
      const immediateCallStart = getRangeStart(immediateCall);
      return immediateCallStart === null || immediateCallStart < usageBoundary;
    }
    if (!immediateCallFunction) return usageFunction !== null;
    return isFunctionInvokedBeforeUsage(
      immediateCallFunction,
      usageNode,
      usageBoundary,
      scopes,
      visitedSymbolIds,
      new Set(visitedFunctionNodes),
    );
  }
  for (const methodCall of getMethodCalls(functionNode, scopes)) {
    const methodCallFunction = findEnclosingFunction(methodCall);
    if (methodCallFunction === usageFunction) {
      const methodCallStart = getRangeStart(methodCall);
      if (methodCallStart === null || methodCallStart < usageBoundary) return true;
      continue;
    }
    if (!methodCallFunction) {
      if (usageFunction) return true;
      continue;
    }
    if (
      isFunctionInvokedBeforeUsage(
        methodCallFunction,
        usageNode,
        usageBoundary,
        scopes,
        new Set(visitedSymbolIds),
        new Set(visitedFunctionNodes),
      )
    ) {
      return true;
    }
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const symbol = scopes.symbolFor(bindingIdentifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  let wasInvokedBeforeUsage = false;
  walkAst(scopes.rootScope.node, (child) => {
    if (wasInvokedBeforeUsage || !isNodeOfType(child, "Identifier")) return;
    if (scopes.symbolFor(child)?.declarationNode !== symbol.declarationNode) return;
    const call = getDirectCallForExpression(child);
    if (!call) return false;
    const callFunction = findEnclosingFunction(call);
    if (callFunction === usageFunction) {
      const callStart = getRangeStart(call);
      wasInvokedBeforeUsage = callStart === null || callStart < usageBoundary;
      return;
    }
    if (!callFunction) {
      wasInvokedBeforeUsage = usageFunction !== null;
      return;
    }
    wasInvokedBeforeUsage = isFunctionInvokedBeforeUsage(
      callFunction,
      usageNode,
      usageBoundary,
      scopes,
      new Set(visitedSymbolIds),
      new Set(visitedFunctionNodes),
    );
  });
  return wasInvokedBeforeUsage;
};

const getMutationUsageBoundary = (usageNode: EsTreeNode, readNode: EsTreeNode): number | null => {
  const readStart = getRangeStart(readNode);
  let readExpression = readNode;
  let readParent = readExpression.parent;
  while (
    readParent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(readParent.type) &&
    "expression" in readParent &&
    readParent.expression === readExpression
  ) {
    readExpression = readParent;
    readParent = readExpression.parent;
  }
  const isDirectUsageArgument =
    (isNodeOfType(usageNode, "CallExpression") || isNodeOfType(usageNode, "NewExpression")) &&
    usageNode.arguments?.some((argument) => argument === readExpression);
  if (isDirectUsageArgument) return usageNode.range?.[1] ?? null;
  if (isAstDescendant(readNode, usageNode)) return readStart;
  return getRangeStart(usageNode);
};

const wasMutatedBeforeUsage = (
  symbol: SymbolDescriptor,
  usageNode: EsTreeNode,
  readNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedMutationSymbolIds: Set<number> = new Set(),
  inheritedUsageBoundary?: number | null,
  readNodesBySymbolId: ReadonlyMap<number, EsTreeNode> = new Map(),
): boolean => {
  if (visitedMutationSymbolIds.has(symbol.id)) return false;
  visitedMutationSymbolIds.add(symbol.id);
  const usageBoundary =
    inheritedUsageBoundary === undefined
      ? getMutationUsageBoundary(usageNode, readNode)
      : inheritedUsageBoundary;
  if (typeof usageBoundary !== "number") return true;
  const usageFunction = findEnclosingFunction(usageNode);
  return symbol.references.some((reference) => {
    const referenceStart = getRangeStart(reference.identifier);
    const simpleAlias = getSimpleAlias(reference.identifier, scopes);
    if (simpleAlias) {
      return wasMutatedBeforeUsage(
        simpleAlias.symbol,
        usageNode,
        readNodesBySymbolId.get(simpleAlias.symbol.id) ?? simpleAlias.readNode,
        scopes,
        new Set(visitedMutationSymbolIds),
        usageBoundary,
        readNodesBySymbolId,
      );
    }
    if (!isPotentialMutationReference(reference.identifier, readNode)) return false;
    if (referenceStart === null) return true;
    const mutationFunction = findEnclosingFunction(reference.identifier);
    if (mutationFunction === usageFunction) return referenceStart < usageBoundary;
    if (!mutationFunction) return usageFunction !== null;
    if (usageFunction && isAstDescendant(usageFunction, mutationFunction)) return true;
    return isFunctionInvokedBeforeUsage(
      mutationFunction,
      usageNode,
      usageBoundary,
      scopes,
      new Set(),
    );
  });
};

const getObjectPropertyProof = (
  objectExpression: EsTreeNode | null | undefined,
  propertyName: string,
  scopes: ScopeAnalysis,
  usageNode: EsTreeNode,
  visitedSymbolIds: Set<number> = new Set(),
  inheritedUsageBoundary?: number | null,
  readNodesBySymbolId: ReadonlyMap<number, EsTreeNode> = new Map(),
): ObjectPropertyProof => {
  if (!objectExpression) return ABSENT_PROPERTY_PROOF;
  const unwrapped = stripParenExpression(objectExpression);
  if (isNodeOfType(unwrapped, "Literal") || isStaticUndefined(unwrapped, scopes)) {
    return ABSENT_PROPERTY_PROOF;
  }
  if (isNodeOfType(unwrapped, "Identifier")) {
    const symbol = scopes.symbolFor(unwrapped);
    const nextReadNodesBySymbolId = new Map(readNodesBySymbolId);
    if (symbol) nextReadNodesBySymbolId.set(symbol.id, unwrapped);
    const usageBoundary =
      inheritedUsageBoundary === undefined
        ? getMutationUsageBoundary(usageNode, unwrapped)
        : inheritedUsageBoundary;
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      !isNodeOfType(symbol.declarationNode.id, "Identifier") ||
      visitedSymbolIds.has(symbol.id) ||
      wasMutatedBeforeUsage(
        symbol,
        usageNode,
        unwrapped,
        scopes,
        new Set(),
        usageBoundary,
        nextReadNodesBySymbolId,
      )
    ) {
      return UNKNOWN_PROPERTY_PROOF;
    }
    visitedSymbolIds.add(symbol.id);
    return getObjectPropertyProof(
      symbol.initializer,
      propertyName,
      scopes,
      usageNode,
      visitedSymbolIds,
      usageBoundary,
      nextReadNodesBySymbolId,
    );
  }
  if (isNodeOfType(unwrapped, "ConditionalExpression")) {
    const consequent = getObjectPropertyProof(
      unwrapped.consequent,
      propertyName,
      scopes,
      usageNode,
      new Set(visitedSymbolIds),
      inheritedUsageBoundary,
      new Map(readNodesBySymbolId),
    );
    const alternate = getObjectPropertyProof(
      unwrapped.alternate,
      propertyName,
      scopes,
      usageNode,
      new Set(visitedSymbolIds),
      inheritedUsageBoundary,
      new Map(readNodesBySymbolId),
    );
    return consequent.status === alternate.status ? consequent : UNKNOWN_PROPERTY_PROOF;
  }
  if (
    isNodeOfType(unwrapped, "CallExpression") &&
    isNodeOfType(unwrapped.callee, "MemberExpression") &&
    !unwrapped.callee.computed &&
    isNodeOfType(unwrapped.callee.object, "Identifier") &&
    unwrapped.callee.object.name === "Object" &&
    scopes.isGlobalReference(unwrapped.callee.object) &&
    isNodeOfType(unwrapped.callee.property, "Identifier") &&
    unwrapped.callee.property.name === "freeze"
  ) {
    return getObjectPropertyProof(
      unwrapped.arguments?.[0],
      propertyName,
      scopes,
      usageNode,
      visitedSymbolIds,
      inheritedUsageBoundary,
      readNodesBySymbolId,
    );
  }
  if (!isNodeOfType(unwrapped, "ObjectExpression")) return UNKNOWN_PROPERTY_PROOF;
  const properties = unwrapped.properties ?? [];
  for (let propertyIndex = properties.length - 1; propertyIndex >= 0; propertyIndex -= 1) {
    const property = properties[propertyIndex];
    if (!property) continue;
    if (isNodeOfType(property, "SpreadElement")) {
      const spreadProof = getObjectPropertyProof(
        property.argument,
        propertyName,
        scopes,
        unwrapped,
        new Set(visitedSymbolIds),
        undefined,
      );
      if (spreadProof.status !== "absent") return spreadProof;
      continue;
    }
    if (
      !isNodeOfType(property, "Property") ||
      getStaticPropertyKeyName(property) !== propertyName
    ) {
      continue;
    }
    return isStaticUndefined(property.value, scopes)
      ? UNDEFINED_PROPERTY_PROOF
      : PRESENT_PROPERTY_PROOF;
  }
  return ABSENT_PROPERTY_PROOF;
};

const objectHasExplicitProperty = (
  objectExpression: EsTreeNode | null | undefined,
  propertyName: string,
  scopes: ScopeAnalysis,
  usageNode: EsTreeNode,
): boolean =>
  getObjectPropertyProof(objectExpression, propertyName, scopes, usageNode).status === "present";

const hasExplicitLocaleArgument = (
  argument: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!argument) return false;
  const unwrapped = stripParenExpression(argument);
  if (
    (isNodeOfType(unwrapped, "Identifier") &&
      unwrapped.name === "undefined" &&
      scopes.isGlobalReference(unwrapped)) ||
    (isNodeOfType(unwrapped, "UnaryExpression") && unwrapped.operator === "void")
  ) {
    return false;
  }
  return true;
};

// `date.toLocaleString("en-US", { timeZone: "UTC" })` is deterministic —
// both renders format identically no matter where they run. A locale
// WITHOUT a timeZone still mismatches for dates (the server's zone shifts
// the rendered day/time), so only the Date-receiver shapes keep firing.
const isDeterministicLocaleMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  receiverIsProvablyDate: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  const localeArgument = call.arguments?.[0];
  if (!hasExplicitLocaleArgument(localeArgument, scopes)) return false;
  const optionsArgument = call.arguments?.[1];
  if (objectHasExplicitProperty(optionsArgument, "timeZone", scopes, call)) return true;
  // Explicit locale, no timeZone: still environment-dependent when the
  // receiver is a date. An unknown receiver could be a number (locale is
  // its only environment input), so stay quiet there.
  return !DATE_ONLY_LOCALE_METHOD_NAMES.has(methodName) && !receiverIsProvablyDate;
};

const matchLocaleMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): LocaleFormatMatch | null => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const methodName = callee.property.name;
  if (!LOCALE_FORMAT_METHOD_NAMES.has(methodName)) return null;
  const receiverIsProvablyDate = isProvableDateExpression(callee.object);
  if (
    methodName === "toLocaleString" &&
    !receiverIsProvablyDate &&
    !receiverNameLooksDateFlavored(callee.object)
  ) {
    return null;
  }
  if (isDeterministicLocaleMethodCall(call, methodName, receiverIsProvablyDate, scopes))
    return null;
  return { node: call, display: `${methodName}()` };
};

const getIntlFormatterName = (expression: EsTreeNode | null | undefined): string | null => {
  if (!expression) return null;
  const unwrapped = stripParenExpression(expression);
  if (!isNodeOfType(unwrapped, "CallExpression") && !isNodeOfType(unwrapped, "NewExpression")) {
    return null;
  }
  const callee = unwrapped.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Intl") return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  return INTL_FORMATTER_NAMES.has(callee.property.name) ? callee.property.name : null;
};

const isDeterministicIntlConstruction = (
  construction: EsTreeNode,
  formatterName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(construction, "CallExpression") &&
    !isNodeOfType(construction, "NewExpression")
  ) {
    return false;
  }
  if (!hasExplicitLocaleArgument(construction.arguments?.[0], scopes)) return false;
  if (formatterName !== "DateTimeFormat") return true;
  return objectHasExplicitProperty(construction.arguments?.[1], "timeZone", scopes, construction);
};

// `Intl.DateTimeFormat().format(date)` — direct chain, or through a
// same-scope const (`const formatter = new Intl.DateTimeFormat(); …
// formatter.format(date)`).
const matchIntlFormatCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): LocaleFormatMatch | null => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!INTL_FORMAT_METHOD_NAMES.has(callee.property.name)) return null;

  let construction: EsTreeNode | null | undefined = stripParenExpression(callee.object);
  if (isNodeOfType(construction, "Identifier")) {
    const binding = findVariableInitializer(construction, construction.name);
    construction = binding?.initializer ? stripParenExpression(binding.initializer) : null;
  }
  if (!construction) return null;
  const formatterName = getIntlFormatterName(construction);
  if (!formatterName) return null;
  if (isDeterministicIntlConstruction(construction, formatterName, scopes)) return null;
  return { node: call, display: `Intl.${formatterName}().${callee.property.name}()` };
};

// Date's default string form embeds the runtime timezone ("GMT-0700
// (Pacific Daylight Time)"). Only argument-carrying constructions match —
// bare `new Date()` is wall-clock nondeterminism and already owned by
// rendering-hydration-mismatch-time.
const isDeterministicInputDateConstruction = (
  expression: EsTreeNode | null | undefined,
): boolean => {
  if (!expression) return false;
  const unwrapped = stripParenExpression(expression);
  if (!isNodeOfType(unwrapped, "NewExpression")) return false;
  if (!isNodeOfType(unwrapped.callee, "Identifier") || unwrapped.callee.name !== "Date") {
    return false;
  }
  return (unwrapped.arguments?.length ?? 0) > 0;
};

const matchDateDefaultStringification = (node: EsTreeNode): LocaleFormatMatch | null => {
  if (isNodeOfType(node, "CallExpression")) {
    const callee = node.callee;
    // new Date(value).toString()
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "toString" &&
      isDeterministicInputDateConstruction(callee.object)
    ) {
      return { node, display: "Date.prototype.toString()" };
    }
    // String(new Date(value))
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "String" &&
      isDeterministicInputDateConstruction(node.arguments?.[0])
    ) {
      return { node, display: "String(new Date(…))" };
    }
    return null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    for (const expression of node.expressions ?? []) {
      if (isDeterministicInputDateConstruction(expression)) {
        return { node: expression, display: "`${new Date(…)}`" };
      }
    }
  }
  return null;
};

export const noLocaleFormatInRender = defineRule({
  id: "no-locale-format-in-render",
  title: "Locale/timezone formatting during render",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Format locale/timezone-dependent values in a post-mount useEffect + state, or pass an explicit locale and timeZone so the server and the browser render the same text. Only runs on SSR-capable projects.",
  create: (context: RuleContext): RuleVisitors => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    if (isTestlikeFile) return {};
    // React Native has no server-rendered HTML to hydrate; skip files in
    // RN/Expo packages of mixed monorepos.
    if (classifyReactNativeFileTarget(context) === "react-native") return {};

    let fileHasUseClientDirective = false;
    let fileIsEmailTemplate = false;
    const reportedNodes = new Set<EsTreeNode>();

    const reportIfRenderPhase = (match: LocaleFormatMatch): void => {
      if (reportedNodes.has(match.node)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(match.node, context.scopes);
      if (!componentOrHookNode) return;
      if (fileIsEmailTemplate) return;
      if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
      if (isGatedByFalsyInitialState(match.node, context.scopes)) return;
      if (isAfterClientOnlyEarlyReturn(match.node, componentOrHookNode, context.scopes)) return;
      if (hasSuppressHydrationWarningAttribute(findEnclosingJsxOpeningElement(match.node))) return;
      if (
        isGeneratedImageRenderContext(
          context,
          findEnclosingJsxOpeningElement(match.node)?.parent ?? match.node,
        )
      ) {
        return;
      }
      reportedNodes.add(match.node);
      context.report({
        node: match.node,
        message: `This can cause a hydration mismatch because ${match.display} formats with the server's locale and timezone during server rendering but the user's in the browser. Format it in a post-mount useEffect, or pass an explicit locale and timeZone.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileHasUseClientDirective = hasDirective(node, "use client");
        fileIsEmailTemplate = hasEmailTemplateImport(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const match =
          matchLocaleMethodCall(node, context.scopes) ??
          matchIntlFormatCall(node, context.scopes) ??
          matchDateDefaultStringification(node);
        if (match) reportIfRenderPhase(match);
      },
      TemplateLiteral(node: EsTreeNodeOfType<"TemplateLiteral">) {
        const match = matchDateDefaultStringification(node);
        if (match) reportIfRenderPhase(match);
      },
      // A same-file helper called from JSX runs during render even though
      // its own body sits behind a plain function boundary — resolve one
      // level deep so `<td>{formatCreatedAt(row)}</td>` still reports the
      // locale call inside `formatCreatedAt`.
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        const expression = stripParenExpression(node.expression);
        if (!isNodeOfType(expression, "CallExpression")) return;
        if (!isNodeOfType(expression.callee, "Identifier")) return;
        const helperName = expression.callee.name;
        const componentOrHookNode = findRenderPhaseComponentOrHook(node, context.scopes);
        if (!componentOrHookNode) return;
        const binding = findVariableInitializer(expression.callee, helperName);
        const helperNode = binding?.initializer;
        if (!helperNode || !isFunctionLike(helperNode)) return;
        if (componentOrHookDisplayNameForFunction(helperNode)) return;
        walkAst(helperNode.body ?? helperNode, (child: EsTreeNode) => {
          if (isFunctionLike(child)) return false;
          if (!isNodeOfType(child, "CallExpression")) return;
          const match =
            matchLocaleMethodCall(child, context.scopes) ??
            matchIntlFormatCall(child, context.scopes);
          if (!match || reportedNodes.has(match.node)) return;
          if (fileIsEmailTemplate) return;
          if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
          if (isGatedByFalsyInitialState(node, context.scopes)) return;
          if (isAfterClientOnlyEarlyReturn(node, componentOrHookNode, context.scopes)) return;
          if (hasSuppressHydrationWarningAttribute(findEnclosingJsxOpeningElement(node))) return;
          reportedNodes.add(match.node);
          context.report({
            node: match.node,
            message: `This can cause a hydration mismatch because ${match.display} (reached from JSX through "${helperName}") formats with the server's locale and timezone during server rendering but the user's in the browser. Format it in a post-mount useEffect, or pass an explicit locale and timeZone.`,
          });
        });
      },
    };
  },
});
