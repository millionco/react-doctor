import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { collectEarlierAndGuardOperands } from "../../utils/collect-earlier-and-guard-operands.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getObjectIntegrityMethodName } from "../../utils/unwrap-object-integrity-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

interface ObjectProjection {
  methodName: string;
  source: EsTreeNode;
}

const OBJECT_CARDINALITY_PROJECTION_METHOD_NAMES: ReadonlySet<string> = new Set(["keys", "values"]);

const getGlobalObjectProjection = (
  expression: EsTreeNode,
  context: RuleContext,
): ObjectProjection | null => {
  const callExpression = stripParenExpression(expression);
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = stripParenExpression(callee.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Object" ||
    !context.scopes.isGlobalReference(receiver)
  ) {
    return null;
  }
  const methodName = getStaticPropertyName(callee);
  if (!methodName || !OBJECT_CARDINALITY_PROJECTION_METHOD_NAMES.has(methodName)) return null;
  const callArguments = callExpression.arguments ?? [];
  if (callArguments.length !== 1 || isNodeOfType(callArguments[0], "SpreadElement")) return null;
  return { methodName, source: callArguments[0] };
};

const isPlainDataObjectLiteral = (expression: EsTreeNode): boolean => {
  const objectExpression = stripParenExpression(expression);
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return false;
  return (objectExpression.properties ?? []).every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method === true
    ) {
      return false;
    }
    const propertyValue = stripParenExpression(property.value);
    return (
      isNodeOfType(propertyValue, "Literal") ||
      (isNodeOfType(propertyValue, "TemplateLiteral") && propertyValue.expressions.length === 0)
    );
  });
};

const getGlobalObjectFreezeArgument = (
  expression: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const callExpression = stripParenExpression(expression);
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  if (getObjectIntegrityMethodName(callExpression, context.scopes) !== "freeze") return null;
  const callArguments = callExpression.arguments ?? [];
  if (callArguments.length !== 1 || isNodeOfType(callArguments[0], "SpreadElement")) return null;
  return callArguments[0];
};

const resolveStablePlainObjectRootId = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): number | null => {
  const source = stripParenExpression(expression);
  if (!isNodeOfType(source, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(source);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  const directConstInitializer = getDirectConstInitializer(symbol);
  if (!directConstInitializer) return null;
  visitedSymbolIds.add(symbol.id);
  const initializer = stripParenExpression(directConstInitializer);
  const frozenValue = getGlobalObjectFreezeArgument(initializer, context);
  if (frozenValue) return isPlainDataObjectLiteral(frozenValue) ? symbol.id : null;
  return resolveStablePlainObjectRootId(initializer, context, visitedSymbolIds);
};

const areEqualCardinalityObjectProjections = (
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
  context: RuleContext,
): boolean => {
  const receiverProjection = getGlobalObjectProjection(receiverArray, context);
  const indexedProjection = getGlobalObjectProjection(indexedArray, context);
  if (!receiverProjection || !indexedProjection) return false;
  if (receiverProjection.methodName === indexedProjection.methodName) return false;
  const receiverRootId = resolveStablePlainObjectRootId(receiverProjection.source, context);
  const indexedRootId = resolveStablePlainObjectRootId(indexedProjection.source, context);
  return receiverRootId !== null && receiverRootId === indexedRootId;
};

const findIndexedArrayObject = (
  callbackBody: EsTreeNode,
  indexParameterName: string,
): EsTreeNode | null => {
  let indexedArrayObject: EsTreeNode | null = null;
  walkAst(callbackBody, (child: EsTreeNode) => {
    if (indexedArrayObject) return;
    if (
      isNodeOfType(child, "MemberExpression") &&
      child.computed &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === indexParameterName
    ) {
      indexedArrayObject = child.object;
    }
  });
  return indexedArrayObject;
};

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? node.expression : node;

const LENGTH_EQUALITY_OPERATORS: ReadonlySet<string> = new Set(["===", "=="]);
// Inequality AND relational operators: a deliberate `a.length > b.length`
// guard (partial-input validation) proves the author already thought about
// diverging lengths, so the "check length first" advice is noise there.
const LENGTH_MISMATCH_OPERATORS: ReadonlySet<string> = new Set(["!==", "!=", ">", "<", ">=", "<="]);
const LENGTH_ANY_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  ...LENGTH_EQUALITY_OPERATORS,
  ...LENGTH_MISMATCH_OPERATORS,
]);

// `<a>.length <op> <b>.length` (in either operand order) comparing the
// two arrays under test, for the given operator set.
const isLengthComparison = (
  candidate: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
  operators: ReadonlySet<string>,
): boolean => {
  const binaryGuard = unwrapChainExpression(candidate);
  if (!isNodeOfType(binaryGuard, "BinaryExpression")) return false;
  if (!operators.has(binaryGuard.operator)) return false;
  const leftSide = unwrapChainExpression(binaryGuard.left);
  const rightSide = unwrapChainExpression(binaryGuard.right);
  if (!isMemberProperty(leftSide, "length")) return false;
  if (!isMemberProperty(rightSide, "length")) return false;
  const leftLengthObject = unwrapChainExpression(leftSide.object);
  const rightLengthObject = unwrapChainExpression(rightSide.object);
  const normalizedReceiver = unwrapChainExpression(receiverArray);
  const normalizedIndexed = unwrapChainExpression(indexedArray);
  const matchesReceiverThenIndexed =
    areExpressionsStructurallyEqual(leftLengthObject, normalizedReceiver) &&
    areExpressionsStructurallyEqual(rightLengthObject, normalizedIndexed);
  const matchesIndexedThenReceiver =
    areExpressionsStructurallyEqual(leftLengthObject, normalizedIndexed) &&
    areExpressionsStructurallyEqual(rightLengthObject, normalizedReceiver);
  return matchesReceiverThenIndexed || matchesIndexedThenReceiver;
};

// A statement that ends the current control-flow path (so a guarded
// `if (mismatch) return/throw` makes the comparison below unreachable on
// the mismatch path). Handles both `if (…) return x;` and a single-stmt
// `if (…) { return x; }` block.
const doesStatementTerminate = (statement: EsTreeNode | null | undefined): boolean => {
  if (!statement) return false;
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    const statements = statement.body ?? [];
    return statements.some((inner) => doesStatementTerminate(inner as EsTreeNode));
  }
  return false;
};

// Falling through `if (x || y || …) return` means EVERY operand was falsy,
// so a length-mismatch operand among them guarantees the lengths matched.
const flattenLogicalOrChain = (node: EsTreeNode): EsTreeNode[] => {
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
    return [...flattenLogicalOrChain(node.left), ...flattenLogicalOrChain(node.right)];
  }
  return [node];
};

// A write to either compared array between the guard and the comparison
// makes the guard stale — the lengths it checked no longer describe the
// values being compared.
const isEitherArrayReassignedIn = (
  statements: EsTreeNode[],
  fromIndex: number,
  toIndex: number,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean => {
  for (let index = fromIndex; index < toIndex; index += 1) {
    let didFindReassignment = false;
    walkAst(statements[index], (child: EsTreeNode) => {
      if (didFindReassignment) return false;
      const writeTarget = isNodeOfType(child, "AssignmentExpression")
        ? child.left
        : isNodeOfType(child, "UpdateExpression")
          ? child.argument
          : null;
      if (!writeTarget) return;
      if (
        areExpressionsStructurallyEqual(writeTarget, receiverArray) ||
        areExpressionsStructurallyEqual(writeTarget, indexedArray)
      ) {
        didFindReassignment = true;
      }
    });
    if (didFindReassignment) return true;
  }
  return false;
};

// `if (a.length !== b.length) return false;` written as an early-return
// guard in a PRECEDING statement (in this block or any enclosing block),
// or an ENCLOSING `if (a.length === b.length) { … }` equality gate,
// already short-circuits the comparison — recognize both. The guard is
// invalidated when either array is reassigned between guard and
// comparison, or when a nested function's parameter shadows a compared
// array name (the guarded binding is not the one being compared).
const hasDominatingLengthGuard = (
  callNode: EsTreeNode,
  receiverArray: EsTreeNode,
  indexedArray: EsTreeNode,
): boolean => {
  const comparedRootNames = [
    getRootIdentifierName(receiverArray),
    getRootIdentifierName(indexedArray),
  ].filter((rootName): rootName is string => Boolean(rootName));
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const parameterNames = new Set<string>();
      for (const parameter of ancestor.params ?? []) {
        collectPatternNames(parameter, parameterNames);
      }
      if (comparedRootNames.some((rootName) => parameterNames.has(rootName))) return false;
    }
    if (isNodeOfType(ancestor, "IfStatement") && ancestor.consequent === child) {
      const equalityGateHolds = flattenLogicalAndChain(ancestor.test).some((guardOperand) =>
        isLengthComparison(guardOperand, receiverArray, indexedArray, LENGTH_EQUALITY_OPERATORS),
      );
      if (equalityGateHolds) return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements: EsTreeNode[] = ancestor.body ?? [];
      const statementIndex = statements.indexOf(child);
      for (let guardIndex = 0; guardIndex < statementIndex; guardIndex += 1) {
        const statement = statements[guardIndex];
        if (!isNodeOfType(statement, "IfStatement")) continue;
        const mismatchGuardHolds = flattenLogicalOrChain(statement.test).some((guardOperand) =>
          isLengthComparison(guardOperand, receiverArray, indexedArray, LENGTH_MISMATCH_OPERATORS),
        );
        if (!mismatchGuardHolds) continue;
        if (!doesStatementTerminate(statement.consequent as EsTreeNode)) continue;
        if (
          isEitherArrayReassignedIn(
            statements,
            guardIndex + 1,
            statementIndex,
            receiverArray,
            indexedArray,
          )
        ) {
          continue;
        }
        return true;
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// `mismatch || !a.every(…)` is the De Morgan twin of
// `match && a.every(…)`: falling into the every() operand means the
// earlier length operand was already falsy, so lengths were handled.
const collectEarlierOrOperands = (node: EsTreeNode): EsTreeNode[] => {
  const earlierOperands: EsTreeNode[] = [];
  let currentNode: EsTreeNode = node;
  let parentNode: EsTreeNode | null = currentNode.parent ?? null;
  while (parentNode) {
    if (isNodeOfType(parentNode, "LogicalExpression")) {
      if (parentNode.operator === "||" && parentNode.right === currentNode) {
        earlierOperands.push(...flattenLogicalOrChain(parentNode.left));
      }
      currentNode = parentNode;
      parentNode = currentNode.parent ?? null;
      continue;
    }
    if (
      isNodeOfType(parentNode, "ChainExpression") ||
      (isNodeOfType(parentNode, "UnaryExpression") && parentNode.operator === "!")
    ) {
      currentNode = parentNode;
      parentNode = currentNode.parent ?? null;
      continue;
    }
    break;
  }
  return earlierOperands;
};

const LENGTH_PRESERVING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "slice",
  "map",
  "sort",
  "reverse",
  "toSorted",
  "toReversed",
]);

// Peels wrappers that keep the element count intact: `[...x]`,
// `x.slice()`, `x.slice(0)`, `x.map(fn)`, `x.sort(…)`, `x.reverse()`,
// `x.toSorted(…)`, `x.toReversed()`, `Array.from(x)`.
const peelLengthPreservingDerivation = (expression: EsTreeNode): EsTreeNode => {
  let current = unwrapChainExpression(expression);
  for (;;) {
    if (
      isNodeOfType(current, "ArrayExpression") &&
      current.elements?.length === 1 &&
      isNodeOfType(current.elements[0], "SpreadElement")
    ) {
      current = unwrapChainExpression(current.elements[0].argument);
      continue;
    }
    if (isNodeOfType(current, "CallExpression")) {
      const callee = unwrapChainExpression(current.callee);
      if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
        const calleeObject = unwrapChainExpression(callee.object);
        if (
          isNodeOfType(calleeObject, "Identifier") &&
          calleeObject.name === "Array" &&
          callee.property.name === "from" &&
          current.arguments?.length === 1
        ) {
          current = unwrapChainExpression(current.arguments[0]);
          continue;
        }
        if (LENGTH_PRESERVING_METHOD_NAMES.has(callee.property.name)) {
          const isBoundedSlice =
            callee.property.name === "slice" && (current.arguments ?? []).length > 0;
          if (!isBoundedSlice) {
            current = calleeObject;
            continue;
          }
        }
      }
    }
    return current;
  }
};

const findConstInitializer = (identifierName: string, fromNode: EsTreeNode): EsTreeNode | null => {
  let child: EsTreeNode = fromNode;
  let ancestor: EsTreeNode | null | undefined = fromNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const parameterNames = new Set<string>();
      for (const parameter of ancestor.params ?? []) {
        collectPatternNames(parameter, parameterNames);
      }
      if (parameterNames.has(identifierName)) return null;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements: EsTreeNode[] = ancestor.body ?? [];
      const childIndex = statements.indexOf(child);
      const searchEnd = childIndex === -1 ? statements.length : childIndex;
      for (let index = 0; index < searchEnd; index += 1) {
        const statement = statements[index];
        if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") continue;
        for (const declarator of statement.declarations ?? []) {
          if (
            isNodeOfType(declarator, "VariableDeclarator") &&
            isNodeOfType(declarator.id, "Identifier") &&
            declarator.id.name === identifierName &&
            declarator.init
          ) {
            return declarator.init as EsTreeNode;
          }
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// `const sortedA = [...a].sort()` compared element-wise is really a
// comparison of `a` — guards on the source array cover the copy because
// the derivation preserves length.
const resolveComparedArraySource = (expression: EsTreeNode, scopeNode: EsTreeNode): EsTreeNode => {
  let current = peelLengthPreservingDerivation(expression);
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isNodeOfType(current, "Identifier")) return current;
    const initializer = findConstInitializer(current.name, scopeNode);
    if (!initializer) return current;
    const peeledInitializer = peelLengthPreservingDerivation(initializer);
    if (peeledInitializer === unwrapChainExpression(initializer)) return current;
    current = peeledInitializer;
  }
  return current;
};

const PREFIX_INTENT_NAME_PATTERN = /prefix|startswith/i;

// `const isPrefix = (chain, other) => chain.every((id, i) => other[i] === id)`
// compares a prefix on purpose — the doc's sole false-positive carve-out.
const isInsidePrefixNamedFunction = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      if (
        isNodeOfType(ancestor, "FunctionDeclaration") &&
        isNodeOfType(ancestor.id, "Identifier") &&
        PREFIX_INTENT_NAME_PATTERN.test(ancestor.id.name)
      ) {
        return true;
      }
      const holder = ancestor.parent;
      if (
        holder &&
        isNodeOfType(holder, "VariableDeclarator") &&
        isNodeOfType(holder.id, "Identifier") &&
        PREFIX_INTENT_NAME_PATTERN.test(holder.id.name)
      ) {
        return true;
      }
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst = defineRule({
  id: "js-length-check-first",
  title: "Array compare without length check",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Check `a.length === b.length && a.every((x, i) => x === b[i])` so arrays of different sizes stop right away",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (!isNodeOfType(node.callee.property, "Identifier")) return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (!isInlineFunctionExpression(callback)) {
        return;
      }
      const callbackParameters = callback.params ?? [];
      if (callbackParameters.length < 2) return; // need (item, index, ...) to address other array
      const indexParameter = callbackParameters[1];
      if (!isNodeOfType(indexParameter, "Identifier")) return;

      const indexedArrayObject = findIndexedArrayObject(callback.body, indexParameter.name);
      if (!indexedArrayObject) return;

      const receiverArrayObject = node.callee.object;
      const resolvedReceiverSource = resolveComparedArraySource(receiverArrayObject, node);
      const resolvedIndexedSource = resolveComparedArraySource(indexedArrayObject, node);

      // Same array on both sides (directly or via a length-preserving
      // derivation like `.map()`): lengths are equal by construction, a
      // length precheck would be dead code.
      if (areExpressionsStructurallyEqual(resolvedReceiverSource, resolvedIndexedSource)) return;
      if (
        areEqualCardinalityObjectProjections(receiverArrayObject, indexedArrayObject, context) ||
        areEqualCardinalityObjectProjections(resolvedReceiverSource, resolvedIndexedSource, context)
      ) {
        return;
      }

      const comparedArrayPairs: [EsTreeNode, EsTreeNode][] = [
        [receiverArrayObject, indexedArrayObject],
        [resolvedReceiverSource, resolvedIndexedSource],
      ];

      const earlierAndGuardOperands = collectEarlierAndGuardOperands(node);
      // Any length comparison in the guard counts: equality gates the loop,
      // a relational check (`node.length >= ancestor.length && …`) is a
      // deliberate prefix comparison — the doc's false-positive carve-out.
      const isAlreadyLengthGuarded = earlierAndGuardOperands.some((guardOperand) =>
        comparedArrayPairs.some(([receiverSide, indexedSide]) =>
          isLengthComparison(
            guardOperand,
            receiverSide,
            indexedSide,
            LENGTH_ANY_COMPARISON_OPERATORS,
          ),
        ),
      );
      if (isAlreadyLengthGuarded) return;

      const earlierOrGuardOperands = collectEarlierOrOperands(node);
      const isMismatchGuardedByOrChain = earlierOrGuardOperands.some((guardOperand) =>
        comparedArrayPairs.some(([receiverSide, indexedSide]) =>
          isLengthComparison(guardOperand, receiverSide, indexedSide, LENGTH_MISMATCH_OPERATORS),
        ),
      );
      if (isMismatchGuardedByOrChain) return;

      if (
        comparedArrayPairs.some(([receiverSide, indexedSide]) =>
          hasDominatingLengthGuard(node, receiverSide, indexedSide),
        )
      ) {
        return;
      }
      if (isInsidePrefixNamedFunction(node)) return;

      context.report({
        node,
        message:
          "This is slow because .every() compares two arrays item by item, so check `a.length === b.length` first to bail out immediately when sizes differ",
      });
    },
  }),
});
