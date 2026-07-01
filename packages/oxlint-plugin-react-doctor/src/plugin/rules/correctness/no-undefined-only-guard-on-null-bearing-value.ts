import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This guards only against `undefined`, so a `null` value slips into the branch that dereferences it and throws a `TypeError`. Use `== null` / `!= null` to cover `null` as well.";

const STATEMENT_ANCESTOR_TYPES = new Set<string>([
  "ExpressionStatement",
  "VariableDeclaration",
  "ReturnStatement",
  "IfStatement",
  "SwitchCase",
  "ThrowStatement",
]);

const isUndefinedIdentifier = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Identifier") && node.name === "undefined";

const isNullLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === null;

// The identifier compared against `undefined` in `x === undefined` / the
// reverse-operand form, when the other operand is exactly `undefined`.
const undefinedGuardOperand = (
  node: EsTreeNodeOfType<"BinaryExpression">,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (node.operator !== "===" && node.operator !== "!==") return null;
  const left = node.left as EsTreeNode;
  const right = node.right as EsTreeNode;
  if (isNodeOfType(left, "Identifier") && isUndefinedIdentifier(right)) return left;
  if (isNodeOfType(right, "Identifier") && isUndefinedIdentifier(left)) return right;
  return null;
};

// Local syntactic evidence (AST-only, no type checker) that the operand can be
// `null`: its declaration carries an explicit `T | null` union annotation in
// this file.
const declaredTypeIncludesNull = (referenceNode: EsTreeNode, name: string): boolean => {
  const binding = findVariableInitializer(referenceNode, name);
  const bindingIdentifier = binding?.bindingIdentifier;
  if (!bindingIdentifier) return false;
  const typeAnnotation = (bindingIdentifier as { typeAnnotation?: EsTreeNode }).typeAnnotation;
  if (!typeAnnotation) return false;
  const annotatedType = (typeAnnotation as { typeAnnotation?: EsTreeNode }).typeAnnotation;
  if (!annotatedType || !isNodeOfType(annotatedType, "TSUnionType")) return false;
  return annotatedType.types.some((member) => isNodeOfType(member as EsTreeNode, "TSNullKeyword"));
};

const findEnclosingStatement = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (STATEMENT_ANCESTOR_TYPES.has(ancestor.type)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// A sibling `=== null` / `!== null` test on the same operand marks a deliberate
// null-vs-undefined split, so the guard is intentional.
const enclosingStatementTestsAgainstNull = (guardNode: EsTreeNode, name: string): boolean => {
  const statement = findEnclosingStatement(guardNode);
  if (!statement) return false;
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found || node === guardNode) return;
    if (
      isNodeOfType(node, "BinaryExpression") &&
      (node.operator === "===" || node.operator === "!==")
    ) {
      const left = node.left as EsTreeNode;
      const right = node.right as EsTreeNode;
      const comparesName =
        (isNodeOfType(left, "Identifier") && left.name === name && isNullLiteral(right)) ||
        (isNodeOfType(right, "Identifier") && right.name === name && isNullLiteral(left));
      if (comparesName) {
        found = true;
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child)
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(statement);
  return found;
};

interface BranchDereferenceScan {
  hasThrowingDereference: boolean;
  hasNullGuard: boolean;
}

// Whether the "present" branch dereferences the operand in a way that throws on
// `null` (member read, call, index) and whether it re-guards it (optional
// chain, null comparison, truthiness test) first.
const scanBranchForDereference = (branch: EsTreeNode, name: string): BranchDereferenceScan => {
  const scan: BranchDereferenceScan = {
    hasThrowingDereference: false,
    hasNullGuard: false,
  };
  const isNamedIdentifier = (node: EsTreeNode | null | undefined): boolean =>
    Boolean(node && isNodeOfType(node, "Identifier") && node.name === name);

  const visit = (node: EsTreeNode): void => {
    if (node !== branch && isFunctionLike(node)) return;

    if (isNodeOfType(node, "MemberExpression") && isNamedIdentifier(node.object as EsTreeNode)) {
      if (node.optional) {
        scan.hasNullGuard = true;
      } else {
        scan.hasThrowingDereference = true;
      }
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNamedIdentifier(node.callee as EsTreeNode) &&
      !node.optional
    ) {
      scan.hasThrowingDereference = true;
    }
    if (
      isNodeOfType(node, "BinaryExpression") &&
      (node.operator === "==" ||
        node.operator === "===" ||
        node.operator === "!=" ||
        node.operator === "!==")
    ) {
      const left = node.left as EsTreeNode;
      const right = node.right as EsTreeNode;
      const comparesNullish =
        (isNamedIdentifier(left) && (isNullLiteral(right) || isUndefinedIdentifier(right))) ||
        (isNamedIdentifier(right) && (isNullLiteral(left) || isUndefinedIdentifier(left)));
      if (comparesNullish) scan.hasNullGuard = true;
    }
    if (
      (isNodeOfType(node, "IfStatement") || isNodeOfType(node, "ConditionalExpression")) &&
      subtreeReferencesName(node.test as EsTreeNode, name)
    ) {
      scan.hasNullGuard = true;
    }

    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child)
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(branch);
  return scan;
};

const subtreeReferencesName = (node: EsTreeNode | null | undefined, name: string): boolean => {
  if (!node) return false;
  let found = false;
  const visit = (current: EsTreeNode): void => {
    if (found) return;
    if (isNodeOfType(current, "Identifier") && current.name === name) {
      found = true;
      return;
    }
    const record = current as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child)
          if (item && typeof item === "object" && "type" in item) visit(item as EsTreeNode);
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as EsTreeNode);
      }
    }
  };
  visit(node);
  return found;
};

// The branch reached when the undefined-only guard treats the operand as
// present, or `null` when this guard shape is not analyzable.
const presentBranchForGuard = (
  guardNode: EsTreeNodeOfType<"BinaryExpression">,
): EsTreeNode | null => {
  const parent = guardNode.parent;
  if (!parent) return null;
  const treatsUndefinedAsAbsent = guardNode.operator === "===";
  if (isNodeOfType(parent, "ConditionalExpression") && parent.test === guardNode) {
    return (treatsUndefinedAsAbsent ? parent.alternate : parent.consequent) as EsTreeNode;
  }
  if (isNodeOfType(parent, "IfStatement") && parent.test === guardNode) {
    if (treatsUndefinedAsAbsent) return (parent.alternate as EsTreeNode | null) ?? null;
    return parent.consequent as EsTreeNode;
  }
  return null;
};

// Flags `x === undefined` / `x !== undefined` when `x`'s in-file type annotation
// includes `| null` AND the present branch dereferences `x` (member read, call,
// index) with no re-guard, so a runtime `null` slips through and throws.
// Deliberate null/undefined splits (a sibling `=== null` test) and non-null
// operands stay quiet.
export const noUndefinedOnlyGuardOnNullBearingValue = defineRule({
  id: "no-undefined-only-guard-on-null-bearing-value",
  title: "Undefined-only guard lets null reach a dereference",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "`x === undefined` is `false` for `null`, so a null-bearing value falls into the present branch and throws when dereferenced. Use `== null` / `!= null` to collapse both `null` and `undefined`.",
  create: (context: RuleContext) => ({
    BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
      const operand = undefinedGuardOperand(node);
      if (!operand) return;
      if (!declaredTypeIncludesNull(operand as EsTreeNode, operand.name)) return;
      if (enclosingStatementTestsAgainstNull(node as EsTreeNode, operand.name)) return;
      const presentBranch = presentBranchForGuard(node);
      if (!presentBranch) return;
      const scan = scanBranchForDereference(presentBranch, operand.name);
      if (!scan.hasThrowingDereference || scan.hasNullGuard) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
