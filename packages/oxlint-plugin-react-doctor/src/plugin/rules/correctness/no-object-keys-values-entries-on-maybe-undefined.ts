import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isEarlyExitIfStatement } from "../../utils/is-early-exit-if-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const OBJECT_ITERATION_METHODS = new Set(["keys", "values", "entries"]);

// Value-position wrappers that a short-circuit still guards THROUGH:
// `x && Object.keys(x).length > 0` reads the call inside `.length`/`> 0`
// before the `&&`, so the logical-operand walk — which stops at the first
// non-logical ancestor — must be entered from the OUTERMOST wrapper to see
// the guard. Climbing these is safe: an enclosing `&&`/`||` short-circuits
// the whole subtree regardless of the wrappers in between.
// `CallExpression` is transparent too: `x && Object.values(x).every(cb)`
// wraps the call in `.every(...)` before the `&&` holds it, and the
// guard-mention requirement keeps unrelated calls sound.
const GUARD_TRANSPARENT_WRAPPER_TYPES = new Set<string>([
  "MemberExpression",
  "BinaryExpression",
  "UnaryExpression",
  "TSNonNullExpression",
  "ParenthesizedExpression",
  "CallExpression",
]);

// Climb from the call through value-position wrappers to the highest node
// still wrapped in one, so the guard walk starts where a logical operator
// can hold it on its right.
const outermostGuardTransparentWrapper = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (current.parent && GUARD_TRANSPARENT_WRAPPER_TYPES.has(current.parent.type)) {
    current = current.parent;
  }
  return current;
};

const MESSAGE =
  "`Object.keys/values/entries` throws `Cannot convert undefined or null to object` when this value is missing — add a `?? {}` fallback or a null check so the call always receives an object.";

const isObjectIterationCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Object") return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!OBJECT_ITERATION_METHODS.has(callee.property.name)) return false;
  // A same-file binding named `Object` shadows the global — bail out.
  if (findVariableInitializer(callee.object, "Object")) return false;
  return true;
};

// Left operands of `&&`/`||` ancestors that evaluated before `node` runs.
// Both operators count: `x && Object.keys(x)` runs the call only when `x`
// is truthy, and the isEmpty idiom `!x || Object.keys(x).length === 0`
// reaches the call only after `!x` was falsy. `??` is excluded — its right
// side runs exactly when the left was nullish, so a mention there proves
// nothing.
const collectShortCircuitLeftOperands = (node: EsTreeNode): EsTreeNode[] => {
  const leftOperands: EsTreeNode[] = [];
  let currentNode: EsTreeNode = node;
  let parentNode: EsTreeNode | null = currentNode.parent ?? null;
  while (parentNode) {
    if (isNodeOfType(parentNode, "LogicalExpression")) {
      if (parentNode.operator !== "??" && parentNode.right === currentNode) {
        leftOperands.push(parentNode.left);
      }
      currentNode = parentNode;
      parentNode = currentNode.parent ?? null;
      continue;
    }
    if (isNodeOfType(parentNode, "ChainExpression")) {
      currentNode = parentNode;
      parentNode = currentNode.parent ?? null;
      continue;
    }
    break;
  }
  return leftOperands;
};

// Dotted access path for `a.b.c` / `a?.b!.c` shapes (Identifier root,
// non-computed properties only); null when the shape is anything richer.
const memberAccessPath = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "ChainExpression") || isNodeOfType(node, "TSNonNullExpression")) {
    return memberAccessPath(node.expression);
  }
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    isNodeOfType(node.property, "Identifier")
  ) {
    const objectPath = memberAccessPath(node.object);
    return objectPath === null ? null : `${objectPath}.${node.property.name}`;
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
        (callbackHolder.arguments ?? []).includes(cursor as never)
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
            return true;
          }
          chainLink = chainLink.parent.parent;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const subtreeContainsMemberPath = (node: EsTreeNode | null | undefined, path: string): boolean => {
  if (!node) return false;
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (
      (isNodeOfType(child, "MemberExpression") || isNodeOfType(child, "Identifier")) &&
      memberAccessPath(child) === path
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// The normalize-then-use idiom: `params = params ?? {}` or
// `if (!params) params = {}` before the call reassigns the binding, so a
// later `Object.keys(params)` no longer sees the optional-param value.
const subtreeAssignsIdentifierName = (node: EsTreeNode, name: string): boolean => {
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === name
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// True when a guard mentioning the value short-circuits, encloses, or
// precedes the call — the `x && Object.keys(x)`, `!x || …`, `if (x) { … }`,
// `!x ? [] : Object.keys(x)`, and `if (!x) return; …` shapes. Branch checks
// credit both the consequent and the alternate: which branch is safe depends
// on the test's polarity, and requiring a mention (not a polarity proof)
// keeps the rule precise on real-world guards.
const isValueGuardedBeforeCall = (
  callNode: EsTreeNode,
  guardMentionsValue: (guard: EsTreeNode) => boolean,
  earlierStatementNormalizesValue?: (statement: EsTreeNode) => boolean,
): boolean => {
  const guardEntry = outermostGuardTransparentWrapper(callNode);
  for (const leftOperand of collectShortCircuitLeftOperands(guardEntry)) {
    if (guardMentionsValue(leftOperand)) return true;
  }
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null = callNode.parent ?? null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      if (
        (ancestor.consequent === child || ancestor.alternate === child) &&
        guardMentionsValue(ancestor.test)
      ) {
        return true;
      }
    }
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const statements = ancestor.body ?? [];
      const childIndex = statements.indexOf(child as never);
      for (let index = 0; index < childIndex; index += 1) {
        const statement = statements[index] as EsTreeNode;
        if (
          isEarlyExitIfStatement(statement) &&
          isNodeOfType(statement, "IfStatement") &&
          guardMentionsValue(statement.test)
        ) {
          return true;
        }
        if (earlierStatementNormalizesValue && earlierStatementNormalizesValue(statement)) {
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
      if (!isObjectIterationCall(node)) return;
      const argument = node.arguments?.[0];
      if (!argument) return;
      if (isInsideCatchTerminatedPromiseChain(node as EsTreeNode)) return;
      const unwrapped = stripParenExpression(argument as EsTreeNode);

      // Case A: the argument itself carries optional chaining (`a?.b`),
      // so it is `undefined` whenever the chain short-circuits — unless a
      // guard mentioning the same access path already proved it present.
      // A `?? {}` fallback makes the argument a LogicalExpression instead,
      // which never reaches this branch.
      if (isNodeOfType(argument as EsTreeNode, "ChainExpression")) {
        const chainPath = guardComparablePathForChain(argument as EsTreeNode);
        const isChainGuarded =
          chainPath !== null &&
          isValueGuardedBeforeCall(node, (guard: EsTreeNode) =>
            subtreeContainsMemberPath(guard, chainPath),
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
        const isParameterGuarded = isValueGuardedBeforeCall(
          node,
          (guard: EsTreeNode) => subtreeReferencesIdentifierName(guard, parameterName),
          (statement: EsTreeNode) => subtreeAssignsIdentifierName(statement, parameterName),
        );
        if (isParameterGuarded) return;
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
