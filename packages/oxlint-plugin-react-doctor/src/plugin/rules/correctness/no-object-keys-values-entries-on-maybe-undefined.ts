import { collectEarlierAndGuardOperands } from "../../utils/collect-earlier-and-guard-operands.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isEarlyExitIfStatement } from "../../utils/is-early-exit-if-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { subtreeReferencesIdentifierName } from "../../utils/subtree-references-identifier-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const OBJECT_ITERATION_METHODS = new Set(["keys", "values", "entries"]);

// Value-position wrappers that a `&&` short-circuit still guards THROUGH:
// `x && Object.keys(x).length > 0` reads the call inside `.length`/`> 0`
// before the `&&`, so `collectEarlierAndGuardOperands` — which stops at the
// first non-logical ancestor — must be entered from the OUTERMOST wrapper to
// see the guard. Climbing these is safe: an enclosing `&&` short-circuits the
// whole subtree regardless of the wrappers in between.
const GUARD_TRANSPARENT_WRAPPER_TYPES = new Set<string>([
  "MemberExpression",
  "BinaryExpression",
  "UnaryExpression",
  "TSNonNullExpression",
  "ParenthesizedExpression",
]);

// Climb from the call through value-position wrappers to the highest node
// still wrapped in one, so the guard walk starts where a `&&` can hold it on
// its right.
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

// True when a truthiness guard on `name` short-circuits, encloses, or
// precedes the call — matching the `x && Object.keys(x)`, `if (x) { … }`,
// and `if (!x) return; …` shapes that make the value provably present.
const isIdentifierGuardedBeforeCall = (callNode: EsTreeNode, name: string): boolean => {
  const guardEntry = outermostGuardTransparentWrapper(callNode);
  for (const operand of collectEarlierAndGuardOperands(guardEntry)) {
    if (subtreeReferencesIdentifierName(operand, name)) return true;
  }
  let child: EsTreeNode = callNode;
  let ancestor: EsTreeNode | null = callNode.parent ?? null;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      subtreeReferencesIdentifierName(ancestor.test, name)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      ancestor.consequent === child &&
      subtreeReferencesIdentifierName(ancestor.test, name)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement")) {
      const statements = ancestor.body ?? [];
      const childIndex = statements.indexOf(child as never);
      for (let index = 0; index < childIndex; index += 1) {
        const statement = statements[index] as EsTreeNode;
        if (
          isEarlyExitIfStatement(statement) &&
          isNodeOfType(statement, "IfStatement") &&
          subtreeReferencesIdentifierName(statement.test, name)
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
      if (!isObjectIterationCall(node)) return;
      const argument = node.arguments?.[0];
      if (!argument) return;
      const unwrapped = stripParenExpression(argument as EsTreeNode);

      // Case A: the argument itself carries optional chaining (`a?.b`),
      // so it is `undefined` whenever the chain short-circuits. A
      // `?? {}` fallback makes the argument a LogicalExpression instead,
      // which never reaches this branch.
      if (isNodeOfType(argument as EsTreeNode, "ChainExpression")) {
        context.report({ node, message: MESSAGE });
        return;
      }

      // Case B: the argument is an optional parameter that was never
      // narrowed by a preceding/enclosing truthiness guard.
      if (isNodeOfType(unwrapped, "Identifier")) {
        if (!isOptionalParameterBinding(unwrapped)) return;
        if (isIdentifierGuardedBeforeCall(node, unwrapped.name)) return;
        context.report({ node, message: MESSAGE });
      }
    },
  }),
});
