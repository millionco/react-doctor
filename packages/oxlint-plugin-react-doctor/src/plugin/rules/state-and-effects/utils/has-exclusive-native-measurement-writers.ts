import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

type MeasurementKey = "width" | "height";

interface MeasurementWriterProofs {
  readonly isNativeElement: (receiver: EsTreeNode, owner: EsTreeNode) => boolean;
  readonly isNativeResizeObserver: (
    construction: EsTreeNodeOfType<"NewExpression">,
    owner: EsTreeNode,
  ) => boolean;
  readonly resolveDeferredObserverCallback: (
    argument: EsTreeNode,
    owner: EsTreeNode,
  ) => EsTreeNode | null;
}

interface MeasurementDimension {
  readonly key: string;
  readonly stateSymbol: SymbolDescriptor;
  readonly setterSymbol: SymbolDescriptor;
}

interface MeasurementContext {
  readonly scopes: ScopeAnalysis;
  readonly program: EsTreeNode;
  readonly owner: EsTreeNode;
  readonly proofs: MeasurementWriterProofs;
}

const isOrdinaryMember = (
  node: EsTreeNode | null | undefined,
  property: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === property;

const isReadOnlyReference = (identifier: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  scopes.referenceFor(identifier)?.flag === "read" && !isWithinAssignmentTarget(identifier);

const hasOnlyReads = (symbol: SymbolDescriptor, context: MeasurementContext): boolean =>
  hasCompleteSymbolReferences(symbol, context.program, context.scopes) &&
  symbol.references.every(({ identifier }) => isReadOnlyReference(identifier, context.scopes));

const readConst = (
  identifier: EsTreeNode,
  context: MeasurementContext,
): { symbol: SymbolDescriptor; initializer: EsTreeNode } | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(identifier);
  const initializer = symbol && getDirectConstInitializer(symbol);
  return symbol && initializer && hasOnlyReads(symbol, context)
    ? { symbol, initializer: stripParenExpression(initializer) }
    : null;
};

const readMemberUse = (identifier: EsTreeNode, property: string): EsTreeNode | null => {
  const reference = findTransparentExpressionRoot(identifier);
  const member = reference.parent;
  return isOrdinaryMember(member, property) && member.object === reference ? member : null;
};

const isDirectRectangleRead = (receiver: EsTreeNode, context: MeasurementContext): boolean => {
  if (
    !isNodeOfType(receiver, "CallExpression") ||
    receiver.optional ||
    receiver.arguments.length !== 0
  ) {
    return false;
  }
  const method = stripParenExpression(receiver.callee);
  return (
    isOrdinaryMember(method, "getBoundingClientRect") &&
    context.proofs.isNativeElement(stripParenExpression(method.object), context.owner)
  );
};

const isDirectRectangleProperty = (receiver: EsTreeNode, context: MeasurementContext): boolean => {
  if (isDirectRectangleRead(receiver, context)) return true;
  const rect = readConst(receiver, context);
  return Boolean(
    rect &&
    findEnclosingFunction(rect.symbol.bindingIdentifier) === findEnclosingFunction(receiver) &&
    isDirectRectangleRead(rect.initializer, context) &&
    rect.symbol.references.every(
      ({ identifier }) => readMemberUse(identifier, "width") || readMemberUse(identifier, "height"),
    ),
  );
};

const hasNativeObserverIngress = (callback: EsTreeNode, context: MeasurementContext): boolean => {
  const callbackRoot = findTransparentExpressionRoot(callback);
  const directConsumer = callbackRoot.parent;
  if (
    isNodeOfType(directConsumer, "NewExpression") &&
    directConsumer.arguments.length === 1 &&
    directConsumer.arguments[0] === callbackRoot
  ) {
    return context.proofs.isNativeResizeObserver(directConsumer, context.owner);
  }
  if (
    !isNodeOfType(directConsumer, "CallExpression") ||
    directConsumer.optional ||
    directConsumer.arguments[0] !== callbackRoot
  ) {
    return false;
  }
  const argument = findTransparentExpressionRoot(directConsumer);
  const construction = argument.parent;
  return (
    isNodeOfType(construction, "NewExpression") &&
    construction.arguments.length === 1 &&
    construction.arguments[0] === argument &&
    context.proofs.isNativeResizeObserver(construction, context.owner) &&
    context.proofs.resolveDeferredObserverCallback(argument, context.owner) === callback
  );
};

const isNullEntryGuard = (identifier: EsTreeNode, callback: EsTreeNode): boolean => {
  const reference = findTransparentExpressionRoot(identifier);
  const operation = reference.parent;
  if (
    !isNodeOfType(operation, "UnaryExpression") ||
    operation.operator !== "!" ||
    operation.argument !== reference
  ) {
    return false;
  }
  const test = findTransparentExpressionRoot(operation);
  const branch = test.parent;
  return (
    isNodeOfType(branch, "IfStatement") &&
    branch.test === test &&
    !branch.alternate &&
    isNodeOfType(branch.consequent, "ReturnStatement") &&
    !branch.consequent.argument &&
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    isNodeOfType(callback.body, "BlockStatement") &&
    callback.body.body[0] === branch
  );
};

const isObserverEntryParameter = (
  entry: SymbolDescriptor,
  context: MeasurementContext,
): boolean => {
  const consumer = findEnclosingFunction(entry.bindingIdentifier);
  if (
    !isNodeOfType(consumer, "ArrowFunctionExpression") ||
    consumer.async ||
    consumer.params.length !== 1
  ) {
    return false;
  }
  const [parameter] = consumer.params;
  if (isNodeOfType(parameter, "ArrayPattern")) {
    return (
      parameter.elements.length === 1 &&
      parameter.elements[0] === entry.bindingIdentifier &&
      isNodeOfType(entry.bindingIdentifier, "Identifier") &&
      hasNativeObserverIngress(consumer, context)
    );
  }
  if (parameter !== entry.bindingIdentifier || !isNodeOfType(parameter, "Identifier")) return false;

  const iteratee = findTransparentExpressionRoot(consumer);
  const iteration = iteratee.parent;
  if (
    !isNodeOfType(iteration, "CallExpression") ||
    iteration.optional ||
    iteration.arguments.length !== 1 ||
    iteration.arguments[0] !== iteratee
  ) {
    return false;
  }
  const forEach = stripParenExpression(iteration.callee);
  if (!isOrdinaryMember(forEach, "forEach")) return false;
  const entriesIdentifier = stripParenExpression(forEach.object);
  if (!isNodeOfType(entriesIdentifier, "Identifier")) return false;
  const entries = context.scopes.symbolFor(entriesIdentifier);
  const callback = findEnclosingFunction(iteration);
  return Boolean(
    entries &&
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    !callback.async &&
    callback.params.length === 1 &&
    callback.params[0] === entries.bindingIdentifier &&
    isNodeOfType(entries.bindingIdentifier, "Identifier") &&
    hasOnlyReads(entries, context) &&
    entries.references.every(
      ({ identifier }) =>
        identifier === entriesIdentifier || isNullEntryGuard(identifier, callback),
    ) &&
    hasNativeObserverIngress(callback, context),
  );
};

const isObserverRectangleProperty = (value: EsTreeNode, context: MeasurementContext): boolean => {
  if (!isOrdinaryMember(value, "contentRect")) return false;
  const receiver = stripParenExpression(value.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const entry = context.scopes.symbolFor(receiver);
  return Boolean(
    entry?.kind === "parameter" &&
    hasOnlyReads(entry, context) &&
    entry.references.every(({ identifier }) => {
      const rect = readMemberUse(identifier, "contentRect");
      if (!rect) return false;
      const root = findTransparentExpressionRoot(rect);
      return (
        (isOrdinaryMember(root.parent, "width") || isOrdinaryMember(root.parent, "height")) &&
        root.parent.object === root
      );
    }) &&
    isObserverEntryParameter(entry, context),
  );
};

const isMeasuredValue = (
  value: EsTreeNode,
  key: MeasurementKey,
  context: MeasurementContext,
): boolean => {
  const operand = stripParenExpression(value);
  const alias = readConst(operand, context);
  if (
    alias &&
    findEnclosingFunction(alias.symbol.bindingIdentifier) !== findEnclosingFunction(operand)
  ) {
    return false;
  }
  const expression = alias?.initializer ?? operand;
  if (!isOrdinaryMember(expression, key)) return false;
  const receiver = stripParenExpression(expression.object);
  return (
    isDirectRectangleProperty(receiver, context) || isObserverRectangleProperty(receiver, context)
  );
};

const hasDirectEvalCall = (owner: EsTreeNode): boolean => {
  let found = false;
  walkAst(owner, (node) => {
    if (found) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") found = true;
  });
  return found;
};

// The caller establishes stock host and React bindings, including native DOMRect,
// ResizeObserverEntry and Array iteration behavior, and closes host/owner escapes.
// The writer check cannot substitute for the separate snapshot gate.
export const hasExclusiveNativeMeasurementWriters = (
  dimension: MeasurementDimension,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
  proofs: MeasurementWriterProofs,
): boolean => {
  const { key, stateSymbol, setterSymbol } = dimension;
  const program = findProgramRoot(owner);
  if (
    !program ||
    (key !== "width" && key !== "height") ||
    stateSymbol.declarationNode !== setterSymbol.declarationNode ||
    findEnclosingFunction(setterSymbol.bindingIdentifier) !== owner ||
    hasDirectEvalCall(owner)
  ) {
    return false;
  }
  const context = { scopes, program, owner, proofs };
  return (
    setterSymbol.references.length > 0 &&
    hasOnlyReads(setterSymbol, context) &&
    setterSymbol.references.every(({ identifier }) => {
      const callee = findTransparentExpressionRoot(identifier);
      const call = callee.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.callee !== callee ||
        call.arguments.length !== 1
      ) {
        return false;
      }
      const [argument] = call.arguments;
      return !isNodeOfType(argument, "SpreadElement") && isMeasuredValue(argument, key, context);
    })
  );
};
