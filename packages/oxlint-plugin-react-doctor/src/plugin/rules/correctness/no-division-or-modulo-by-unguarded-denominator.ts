import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Dividing by this denominator when it can be zero yields `Infinity` or `NaN` (JavaScript never throws on `/ 0`), which renders as `NaN%` or a broken width once the value reaches the UI or an array index. Guard the denominator (`n > 0 ? ... : fallback`) before using the result.";

const getNodeStart = (node: EsTreeNode): number | null => {
  const start = (node as { start?: unknown }).start;
  return typeof start === "number" ? start : null;
};

const subtreeReferencesName = (node: EsTreeNode, name: string): boolean => {
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && child.name === name) {
      found = true;
      return false;
    }
  });
  return found;
};

const containsReturnOrThrow = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child: EsTreeNode) => {
    if (found) return false;
    if (child !== node && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") || isNodeOfType(child, "ThrowStatement")) {
      found = true;
      return false;
    }
  });
  return found;
};

const findEnclosingDeclarator = (
  bindingIdentifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let cursor: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "VariableDeclarator")) return cursor;
    if (isFunctionLike(cursor)) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// True when `identifier` is provably bound to a `const` numeric literal —
// a denominator that can never be zero-at-runtime in a way the rule cares
// about (a literal `0` divisor would be a different, always-broken bug).
const isConstNumericBinding = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (!declarator || declarator.id !== binding.bindingIdentifier) return false;
  const declaration = declarator.parent;
  if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const") {
    return false;
  }
  const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  return Boolean(init && isNodeOfType(init, "Literal") && typeof init.value === "number");
};

// True when `arrayObject` is provably bound to a non-empty array literal via a
// `const` declaration — `arr.length` cannot be zero, so `% arr.length` is safe.
const isConstNonEmptyArrayBinding = (arrayObject: EsTreeNode): boolean => {
  if (!isNodeOfType(arrayObject, "Identifier")) return false;
  const binding = findVariableInitializer(arrayObject, arrayObject.name);
  if (!binding) return false;
  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (!declarator || declarator.id !== binding.bindingIdentifier) return false;
  const declaration = declarator.parent;
  if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const") {
    return false;
  }
  const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  return Boolean(init && isNodeOfType(init, "ArrayExpression") && init.elements.length > 0);
};

const isLengthMember = (node: EsTreeNode): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "length";

// The denominator is a candidate (not provably non-zero) and its root binding
// name for guard-matching, or null when it is provably safe / not a simple
// variable-or-member divisor.
const resolveCandidateDivisor = (divisor: EsTreeNode): string | null => {
  if (isNodeOfType(divisor, "Literal")) return null;
  if (isNodeOfType(divisor, "Identifier")) {
    if (isConstNumericBinding(divisor)) return null;
    return divisor.name;
  }
  if (isNodeOfType(divisor, "MemberExpression")) {
    if (
      isLengthMember(divisor) &&
      isConstNonEmptyArrayBinding(stripParenExpression(divisor.object))
    ) {
      return null;
    }
    return getRootIdentifierName(divisor);
  }
  return null;
};

const findProgramLike = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor) {
    if (isNodeOfType(cursor, "Program")) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// A dominating zero-guard on the divisor: an enclosing ternary/if whose test
// mentions the denominator, or a preceding early-return guard clause on it.
const hasDominatingZeroGuard = (binaryNode: EsTreeNode, divisorRootName: string): boolean => {
  let child: EsTreeNode = binaryNode;
  let cursor: EsTreeNode | null | undefined = binaryNode.parent;
  let enclosingFunction: EsTreeNode | null = null;
  while (cursor) {
    if (
      isNodeOfType(cursor, "ConditionalExpression") &&
      cursor.test !== child &&
      subtreeReferencesName(cursor.test as EsTreeNode, divisorRootName)
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "IfStatement") &&
      cursor.test !== child &&
      subtreeReferencesName(cursor.test as EsTreeNode, divisorRootName)
    ) {
      return true;
    }
    if (isFunctionLike(cursor)) {
      enclosingFunction = cursor;
      break;
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }

  const divisionStart = getNodeStart(binaryNode);
  if (divisionStart === null) return false;
  const guardRoot = enclosingFunction ?? findProgramLike(binaryNode);
  if (!guardRoot) return false;

  let guardFound = false;
  walkAst(guardRoot, (node: EsTreeNode) => {
    if (guardFound) return false;
    if (!isNodeOfType(node, "IfStatement")) return;
    const start = getNodeStart(node);
    if (start === null || start >= divisionStart) return;
    if (!subtreeReferencesName(node.test as EsTreeNode, divisorRootName)) return;
    if (containsReturnOrThrow(node.consequent as EsTreeNode)) guardFound = true;
  });
  return guardFound;
};

const isSetterCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "Identifier") &&
  /^set[A-Z]/.test(node.callee.name);

// The division result reaches a rendered / styled / index sink: a percentage
// (`* 100`), a template/style string, a JSX expression, or a setState call.
const flowsIntoRenderOrIndexSink = (binaryNode: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = binaryNode.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "BinaryExpression") && cursor.operator === "*") {
      const left = stripParenExpression(cursor.left as EsTreeNode);
      const right = stripParenExpression(cursor.right as EsTreeNode);
      if (
        (isNodeOfType(left, "Literal") && left.value === 100) ||
        (isNodeOfType(right, "Literal") && right.value === 100)
      ) {
        return true;
      }
    }
    if (isNodeOfType(cursor, "TemplateLiteral")) return true;
    if (isNodeOfType(cursor, "JSXExpressionContainer")) return true;
    if (isSetterCall(cursor)) return true;
    if (isFunctionLike(cursor)) break;
    cursor = cursor.parent ?? null;
  }
  return false;
};

export const noDivisionOrModuloByUnguardedDenominator = defineRule({
  id: "no-division-or-modulo-by-unguarded-denominator",
  title: "Division or modulo by an unguarded denominator",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A variable/member denominator that can be zero makes `a / b` evaluate to `Infinity`/`NaN` with no thrown error, so the UI renders `NaN%` or a broken width; guard it (`b > 0 ? a / b : 0`) before the result flows to render, style, or an array index.",
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      if (node.operator !== "/" && node.operator !== "%") return;
      const divisor = stripParenExpression(node.right as EsTreeNode);
      const divisorRootName = resolveCandidateDivisor(divisor);
      if (!divisorRootName) return;

      if (node.operator === "%") {
        // The high-signal modulo shape is a cyclic index `% arr.length`; other
        // modulo divisors (constants, small counters) are out of v1 scope.
        if (!isLengthMember(divisor)) return;
      } else if (!flowsIntoRenderOrIndexSink(node as EsTreeNode)) {
        return;
      }

      if (hasDominatingZeroGuard(node as EsTreeNode, divisorRootName)) return;

      context.report({ node: node as EsTreeNode, message: MESSAGE });
    },
  }),
});
