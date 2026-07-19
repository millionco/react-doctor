import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPresenceProvenBeforeNode } from "../../utils/is-presence-proven-before-node.js";
import {
  stripParenExpression,
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
} from "../../utils/strip-paren-expression.js";
import { unwrapNegativeGuardForm } from "../../utils/unwrap-negative-guard-form.js";
import { walkAst } from "../../utils/walk-ast.js";
import { subtreeWritesSymbol } from "../../utils/subtree-writes-symbol.js";
import type { RuleContext } from "../../utils/rule-context.js";

const OBJECT_ITERATION_METHODS = new Set(["keys", "values", "entries"]);

const MESSAGE =
  "`Object.keys/values/entries` throws `Cannot convert undefined or null to object` when this value is missing — add a `?? {}` fallback or a null check so the call always receives an object.";

const isObjectIterationCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier") || receiver.name !== "Object") return false;
  const methodName = getStaticPropertyName(callee);
  return (
    methodName !== null &&
    OBJECT_ITERATION_METHODS.has(methodName) &&
    context.scopes.isGlobalReference(receiver)
  );
};

// Dotted access path for `a.b.c` / `a?.b!.c` shapes (Identifier root,
// non-computed properties only); null when the shape is anything richer.
const memberAccessPath = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "ChainExpression") || isNodeOfType(node, "TSNonNullExpression")) {
    return memberAccessPath(node.expression);
  }
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) !== null) {
    const objectPath = memberAccessPath(node.object);
    return objectPath === null ? null : `${objectPath}.${getStaticPropertyName(node)}`;
  }
  return null;
};

// The comparable path for a chain whose tail is a computed access
// (`rows?.[0]` has no dotted path, but a guard mentioning `rows` — e.g.
// `if (rows.length === 0) return [];` — still covers it): peel computed
// member layers off the end until a dotted path resolves.
const guardComparablePathForChain = (node: EsTreeNode): string | null => {
  let target: EsTreeNode = node;
  while (true) {
    const directPath = memberAccessPath(target);
    if (directPath !== null) return directPath;
    if (isNodeOfType(target, "ChainExpression") || isNodeOfType(target, "TSNonNullExpression")) {
      target = target.expression as EsTreeNode;
      continue;
    }
    if (isNodeOfType(target, "MemberExpression")) {
      target = target.object as EsTreeNode;
      continue;
    }
    return null;
  }
};

// The throw the rule predicts is already consumed: the call sits in a
// callback of a promise chain that ends in `.catch(...)`
// (`fetch(...).then((data) => Object.values(data?.payload?.…)).catch(() =>
// [])`), so the crash never escapes the chain.
const isInsideCatchTerminatedPromiseChain = (callNode: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null = callNode.parent ?? null;
  while (cursor) {
    if (
      isNodeOfType(cursor, "ArrowFunctionExpression") ||
      isNodeOfType(cursor, "FunctionExpression")
    ) {
      const callbackHolder = cursor.parent;
      if (
        callbackHolder &&
        isNodeOfType(callbackHolder, "CallExpression") &&
        isNodeOfType(callbackHolder.callee, "MemberExpression") &&
        !callbackHolder.callee.computed &&
        isNodeOfType(callbackHolder.callee.property, "Identifier") &&
        (callbackHolder.callee.property.name === "then" ||
          callbackHolder.callee.property.name === "catch") &&
        (callbackHolder.arguments ?? []).some((argument) => argument === cursor)
      ) {
        let chainLink: EsTreeNode = callbackHolder;
        while (
          chainLink.parent &&
          isNodeOfType(chainLink.parent, "MemberExpression") &&
          chainLink.parent.object === chainLink &&
          chainLink.parent.parent &&
          isNodeOfType(chainLink.parent.parent, "CallExpression")
        ) {
          if (
            !chainLink.parent.computed &&
            isNodeOfType(chainLink.parent.property, "Identifier") &&
            chainLink.parent.property.name === "catch"
          ) {
            const catchCall = chainLink.parent.parent;
            const catchHandler = catchCall.arguments[0];
            if (
              !catchHandler ||
              (!isNodeOfType(catchHandler as EsTreeNode, "ArrowFunctionExpression") &&
                !isNodeOfType(catchHandler as EsTreeNode, "FunctionExpression"))
            ) {
              return false;
            }
            let rethrows = false;
            walkAst(catchHandler as EsTreeNode, (child) => {
              if (
                child !== catchHandler &&
                (isNodeOfType(child, "ArrowFunctionExpression") ||
                  isNodeOfType(child, "FunctionExpression") ||
                  isNodeOfType(child, "FunctionDeclaration"))
              ) {
                return false;
              }
              if (child !== catchHandler && isNodeOfType(child, "ThrowStatement")) {
                rethrows = true;
                return false;
              }
            });
            return !rethrows;
          }
          chainLink = chainLink.parent.parent;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const rootIdentifier = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let expression = stripParenExpression(node);
  while (isNodeOfType(expression, "MemberExpression")) {
    expression = stripParenExpression(expression.object as EsTreeNode);
  }
  return isNodeOfType(expression, "Identifier") ? expression : null;
};

const bindingKeyForIdentifier = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): string => {
  const symbol = context.scopes.symbolFor(identifier);
  return symbol ? String(symbol.id) : `global:${identifier.name}`;
};

const directNormalizingAssignment = (
  statement: EsTreeNode,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  if (
    isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(statement.expression, "AssignmentExpression")
  ) {
    return statement.expression;
  }
  if (
    isNodeOfType(statement, "IfStatement") &&
    !statement.alternate &&
    isNodeOfType(statement.consequent, "ExpressionStatement") &&
    isNodeOfType(statement.consequent.expression, "AssignmentExpression")
  ) {
    return statement.consequent.expression;
  }
  return null;
};

const testPositivelyProvesPath = (
  test: EsTreeNode,
  expectedPath: string,
  expectedBindingKey: string,
  context: RuleContext,
): boolean => {
  const expression = stripParenExpression(test);
  const matchesPath = (candidate: EsTreeNode): boolean => {
    const candidateRoot = rootIdentifier(candidate);
    const candidateBindingKey = candidateRoot
      ? bindingKeyForIdentifier(candidateRoot, context)
      : null;
    return (
      memberAccessPath(candidate) === expectedPath &&
      candidateRoot !== null &&
      candidateBindingKey === expectedBindingKey
    );
  };
  if (matchesPath(expression)) return true;
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") return false;
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator === "&&") {
      return (
        testPositivelyProvesPath(
          expression.left as EsTreeNode,
          expectedPath,
          expectedBindingKey,
          context,
        ) ||
        testPositivelyProvesPath(
          expression.right as EsTreeNode,
          expectedPath,
          expectedBindingKey,
          context,
        )
      );
    }
    if (expression.operator === "||") {
      return (
        testPositivelyProvesPath(
          expression.left as EsTreeNode,
          expectedPath,
          expectedBindingKey,
          context,
        ) &&
        testPositivelyProvesPath(
          expression.right as EsTreeNode,
          expectedPath,
          expectedBindingKey,
          context,
        )
      );
    }
    return false;
  }
  if (!isNodeOfType(expression, "BinaryExpression")) return false;
  const isAbsent = (operand: EsTreeNode): boolean => {
    const target = stripParenExpression(operand);
    return (
      (isNodeOfType(target, "Literal") && target.value === null) ||
      (isNodeOfType(target, "Identifier") && target.name === "undefined")
    );
  };
  const operandPairs: Array<[EsTreeNode, EsTreeNode]> = [
    [expression.left as EsTreeNode, expression.right as EsTreeNode],
    [expression.right as EsTreeNode, expression.left as EsTreeNode],
  ];
  return operandPairs.some(
    ([candidate, comparisonValue]) =>
      matchesPath(candidate) &&
      isAbsent(comparisonValue) &&
      (expression.operator === "!==" || expression.operator === "!="),
  );
};

const assignmentIndexesByBlock = new WeakMap<
  EsTreeNode,
  {
    assignments: Array<{ index: number; statement: EsTreeNode }>;
    statementIndexes: Map<EsTreeNode, number>;
  }
>();

const indexBlockAssignments = (block: EsTreeNode) => {
  const existing = assignmentIndexesByBlock.get(block);
  if (existing) return existing;
  const body = isNodeOfType(block, "BlockStatement") ? block.body : [];
  const statementIndexes = new Map<EsTreeNode, number>();
  const assignments: Array<{ index: number; statement: EsTreeNode }> = [];
  body.forEach((statement, index) => {
    const statementNode = statement as EsTreeNode;
    statementIndexes.set(statementNode, index);
    if (
      (isNodeOfType(statementNode, "ExpressionStatement") &&
        isNodeOfType(statementNode.expression, "AssignmentExpression")) ||
      (isNodeOfType(statementNode, "IfStatement") &&
        !statementNode.alternate &&
        isNodeOfType(statementNode.consequent, "ExpressionStatement") &&
        isNodeOfType(statementNode.consequent.expression, "AssignmentExpression"))
    ) {
      assignments.push({ index, statement: statementNode });
    }
  });
  const indexed = { assignments, statementIndexes };
  assignmentIndexesByBlock.set(block, indexed);
  return indexed;
};

const isValueGuardedBeforeCall = (
  callNode: EsTreeNode,
  guardProvesValue: (guard: EsTreeNode) => boolean,
  earlierStatementNormalizesValue?: (statement: EsTreeNode) => boolean,
  nodeInvalidatesValue?: (node: EsTreeNode) => boolean,
): boolean => {
  if (isPresenceProvenBeforeNode(callNode, guardProvesValue, nodeInvalidatesValue)) return true;
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null = callNode.parent ?? null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const indexed = indexBlockAssignments(ancestor);
      const childIndex = indexed.statementIndexes.get(child) ?? -1;
      for (const assignment of indexed.assignments) {
        if (assignment.index >= childIndex) break;
        if (
          earlierStatementNormalizesValue &&
          earlierStatementNormalizesValue(assignment.statement)
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const isOptionalParameterBinding = (identifierNode: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifierNode, identifierNode.name);
  if (!binding) return false;
  // Optional params (`params?: T`) carry `optional: true` and no default
  // initializer; only parameters and class members can be `optional`, so
  // the flag alone is a reliable syntactic optionality marker.
  return (
    binding.initializer === null &&
    isNodeOfType(binding.bindingIdentifier, "Identifier") &&
    binding.bindingIdentifier.optional === true
  );
};

export const noObjectKeysValuesEntriesOnMaybeUndefined = defineRule({
  id: "no-object-keys-values-entries-on-maybe-undefined",
  title: "Object.keys/values/entries on maybe-undefined value",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "`Object.keys`, `Object.values`, and `Object.entries` throw on `undefined`/`null`, so pass a `?? {}` fallback or guard the value with a null check before calling them.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isObjectIterationCall(node, context)) return;
      const argument = node.arguments?.[0];
      if (!argument) return;
      if (isInsideCatchTerminatedPromiseChain(node as EsTreeNode)) return;
      const unwrapped = stripParenExpression(argument as EsTreeNode);

      // Case A: the argument itself carries optional chaining (`a?.b`),
      // so it is `undefined` whenever the chain short-circuits — unless a
      // guard mentioning the same access path already proved it present.
      // A `?? {}` fallback makes the argument a LogicalExpression instead,
      // which never reaches this branch.
      const argumentNode = argument as EsTreeNode;
      const argumentContainsOptionalChain = (() => {
        let target = argumentNode;
        while (
          target.type !== "ChainExpression" &&
          "expression" in target &&
          target.expression &&
          TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(target.type)
        ) {
          target = target.expression as EsTreeNode;
        }
        return isNodeOfType(target, "ChainExpression");
      })();
      if (argumentContainsOptionalChain) {
        const chainPath = guardComparablePathForChain(argument as EsTreeNode);
        const chainRoot = rootIdentifier(argument as EsTreeNode);
        const chainRootSymbol = chainRoot ? context.scopes.symbolFor(chainRoot) : null;
        const chainRootBindingKey = chainRoot ? bindingKeyForIdentifier(chainRoot, context) : null;
        const chainRootSymbolIds = chainRootSymbol ? new Set([chainRootSymbol.id]) : null;
        const isChainGuarded =
          chainPath !== null &&
          chainRootBindingKey !== null &&
          isValueGuardedBeforeCall(
            node,
            (guard: EsTreeNode) =>
              testPositivelyProvesPath(guard, chainPath, chainRootBindingKey, context),
            undefined,
            chainRootSymbolIds
              ? (candidate) => subtreeWritesSymbol(candidate, chainRootSymbolIds, context)
              : undefined,
          );
        if (!isChainGuarded) context.report({ node, message: MESSAGE });
        return;
      }

      // Case B: the argument is an optional parameter that was never
      // narrowed by a preceding/enclosing truthiness guard or normalized
      // by a reassignment.
      if (isNodeOfType(unwrapped, "Identifier")) {
        if (!isOptionalParameterBinding(unwrapped)) return;
        const parameterName = unwrapped.name;
        const parameterSymbol = context.scopes.symbolFor(unwrapped);
        if (!parameterSymbol) return;
        const parameterSymbolIds = new Set([parameterSymbol.id]);
        const isParameterGuarded = isValueGuardedBeforeCall(
          node,
          (guard: EsTreeNode) =>
            testPositivelyProvesPath(guard, parameterName, String(parameterSymbol.id), context),
          (statement: EsTreeNode) => {
            const assignment = directNormalizingAssignment(statement);
            if (
              !assignment ||
              !isNodeOfType(assignment, "AssignmentExpression") ||
              (assignment.operator !== "=" &&
                assignment.operator !== "??=" &&
                assignment.operator !== "||=") ||
              !isNodeOfType(assignment.left, "Identifier") ||
              context.scopes.symbolFor(assignment.left)?.id !== parameterSymbol.id
            ) {
              return false;
            }
            if (isNodeOfType(statement, "IfStatement")) {
              const positiveForm = unwrapNegativeGuardForm(statement.test);
              if (
                !positiveForm ||
                !testPositivelyProvesPath(
                  positiveForm,
                  parameterName,
                  String(parameterSymbol.id),
                  context,
                )
              ) {
                return false;
              }
            }
            const value = stripParenExpression(assignment.right as EsTreeNode);
            if (
              isNodeOfType(value, "ObjectExpression") ||
              isNodeOfType(value, "ArrayExpression") ||
              isNodeOfType(value, "NewExpression") ||
              isNodeOfType(value, "FunctionExpression") ||
              isNodeOfType(value, "ArrowFunctionExpression")
            ) {
              return true;
            }
            if (isNodeOfType(value, "Literal")) return value.value !== null;
            if (
              isNodeOfType(value, "LogicalExpression") &&
              (value.operator === "??" || value.operator === "||")
            ) {
              const fallback = stripParenExpression(value.right as EsTreeNode);
              return isNodeOfType(fallback, "ObjectExpression");
            }
            return false;
          },
          (candidate: EsTreeNode) =>
            subtreeWritesSymbol(candidate, parameterSymbolIds, context, (assignment) => {
              const left = stripParenExpression(assignment.left as EsTreeNode);
              return (
                isNodeOfType(left, "Identifier") &&
                context.scopes.symbolFor(left)?.id === parameterSymbol.id &&
                (assignment.operator === "??=" || assignment.operator === "||=")
              );
            }),
        );
        if (isParameterGuarded) return;
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
