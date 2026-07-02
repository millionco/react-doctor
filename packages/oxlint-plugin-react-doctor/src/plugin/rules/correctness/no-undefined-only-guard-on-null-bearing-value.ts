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

const EXIT_STATEMENT_TYPES = new Set<string>([
  "ReturnStatement",
  "ThrowStatement",
  "BreakStatement",
  "ContinueStatement",
]);

const forEachChildNode = (node: EsTreeNode, visit: (child: EsTreeNode) => void): void => {
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

const comparesNameToNull = (node: EsTreeNode, name: string): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (
    node.operator !== "===" &&
    node.operator !== "!==" &&
    node.operator !== "==" &&
    node.operator !== "!="
  ) {
    return false;
  }
  const left = node.left as EsTreeNode;
  const right = node.right as EsTreeNode;
  return (
    (isNodeOfType(left, "Identifier") && left.name === name && isNullLiteral(right)) ||
    (isNodeOfType(right, "Identifier") && right.name === name && isNullLiteral(left))
  );
};

// Any `=== null` / `!= null` test on the same operand anywhere in the enclosing
// function marks deliberate null handling (else-if chains, sequential guard
// clauses, deliberate null-vs-undefined splits), so the guard is intentional.
const enclosingFunctionTestsAgainstNull = (guardNode: EsTreeNode, name: string): boolean => {
  let scopeRoot: EsTreeNode | null | undefined = guardNode.parent;
  while (scopeRoot && !isFunctionLike(scopeRoot) && scopeRoot.type !== "Program") {
    scopeRoot = scopeRoot.parent ?? null;
  }
  if (!scopeRoot) return false;
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found || node === guardNode) return;
    if (comparesNameToNull(node, name)) {
      found = true;
      return;
    }
    forEachChildNode(node, visit);
  };
  visit(scopeRoot);
  return found;
};

const subtreeNegatesName = (node: EsTreeNode, name: string): boolean => {
  let found = false;
  const visit = (current: EsTreeNode): void => {
    if (found) return;
    if (
      isNodeOfType(current, "UnaryExpression") &&
      current.operator === "!" &&
      isNodeOfType(current.argument as EsTreeNode, "Identifier") &&
      (current.argument as EsTreeNodeOfType<"Identifier">).name === name
    ) {
      found = true;
      return;
    }
    forEachChildNode(current, visit);
  };
  visit(node);
  return found;
};

const branchAlwaysExits = (node: EsTreeNode): boolean => {
  if (EXIT_STATEMENT_TYPES.has(node.type)) return true;
  if (!isNodeOfType(node, "BlockStatement")) return false;
  const statements = node.body as EsTreeNode[];
  const lastStatement = statements[statements.length - 1];
  return Boolean(lastStatement && EXIT_STATEMENT_TYPES.has(lastStatement.type));
};

const containerStatements = (node: EsTreeNode): EsTreeNode[] | null => {
  const container = node.parent;
  if (!container) return null;
  const body = (container as { body?: unknown }).body;
  if (!Array.isArray(body) || !body.includes(node)) return null;
  return body as EsTreeNode[];
};

// A prior sibling `if (!x) return ...` guard clause already narrowed away every
// falsy value (including `null`), so the later undefined-only guard is safe.
const priorSiblingExitsOnFalsyOperand = (guardNode: EsTreeNode, name: string): boolean => {
  const statement = findEnclosingStatement(guardNode);
  if (!statement) return false;
  const statements = containerStatements(statement);
  if (!statements) return false;
  for (const sibling of statements) {
    if (sibling === statement) return false;
    if (
      isNodeOfType(sibling, "IfStatement") &&
      subtreeNegatesName(sibling.test as EsTreeNode, name) &&
      branchAlwaysExits(sibling.consequent as EsTreeNode)
    ) {
      return true;
    }
  }
  return false;
};

interface BranchDereferenceScan {
  hasThrowingDereference: boolean;
  hasNullGuard: boolean;
}

// Whether a "present" branch node dereferences the operand in a way that throws
// on `null` (member read, call, index) and whether it re-guards or reassigns it
// (optional chain, null comparison, truthiness test, assignment) first.
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
    if (isNodeOfType(node, "AssignmentExpression") && isNamedIdentifier(node.left as EsTreeNode)) {
      scan.hasNullGuard = true;
    }
    if (
      (isNodeOfType(node, "IfStatement") || isNodeOfType(node, "ConditionalExpression")) &&
      subtreeReferencesName(node.test as EsTreeNode, name)
    ) {
      scan.hasNullGuard = true;
    }

    forEachChildNode(node, visit);
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
    forEachChildNode(current, visit);
  };
  visit(node);
  return found;
};

const fallThroughStatementsAfterGuardClause = (
  ifStatement: EsTreeNodeOfType<"IfStatement">,
): EsTreeNode[] | null => {
  if (!branchAlwaysExits(ifStatement.consequent as EsTreeNode)) return null;
  const statements = containerStatements(ifStatement as EsTreeNode);
  if (!statements) return null;
  const guardIndex = statements.indexOf(ifStatement as EsTreeNode);
  return statements.slice(guardIndex + 1);
};

// The nodes reached when the undefined-only guard treats the operand as
// present, or `null` when this guard shape is not analyzable. Covers ternaries,
// if/else branches, exiting guard clauses (the fall-through statements), and
// `x !== undefined && ...` / `x === undefined || ...` logical guards.
const presentBranchNodesForGuard = (
  guardNode: EsTreeNodeOfType<"BinaryExpression">,
): EsTreeNode[] | null => {
  const parent = guardNode.parent;
  if (!parent) return null;
  const treatsUndefinedAsAbsent = guardNode.operator === "===";
  if (isNodeOfType(parent, "ConditionalExpression") && parent.test === guardNode) {
    return [(treatsUndefinedAsAbsent ? parent.alternate : parent.consequent) as EsTreeNode];
  }
  if (isNodeOfType(parent, "IfStatement") && parent.test === guardNode) {
    if (!treatsUndefinedAsAbsent) return [parent.consequent as EsTreeNode];
    if (parent.alternate) return [parent.alternate as EsTreeNode];
    return fallThroughStatementsAfterGuardClause(parent);
  }
  if (isNodeOfType(parent, "LogicalExpression") && parent.left === guardNode) {
    if (parent.operator === "&&" && !treatsUndefinedAsAbsent) return [parent.right as EsTreeNode];
    if (parent.operator === "||" && treatsUndefinedAsAbsent) return [parent.right as EsTreeNode];
  }
  return null;
};

// Flags `x === undefined` / `x !== undefined` when `x`'s in-file type annotation
// includes `| null` AND the present branch dereferences `x` (member read, call,
// index) with no re-guard, so a runtime `null` slips through and throws.
// Deliberate null/undefined splits (any `=== null` test in the enclosing
// function), prior falsy early returns, and non-null operands stay quiet.
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
      if (enclosingFunctionTestsAgainstNull(node as EsTreeNode, operand.name)) return;
      if (priorSiblingExitsOnFalsyOperand(node as EsTreeNode, operand.name)) return;
      const presentBranchNodes = presentBranchNodesForGuard(node);
      if (!presentBranchNodes || presentBranchNodes.length === 0) return;
      let hasThrowingDereference = false;
      let hasNullGuard = false;
      for (const branchNode of presentBranchNodes) {
        const scan = scanBranchForDereference(branchNode, operand.name);
        hasThrowingDereference = hasThrowingDereference || scan.hasThrowingDereference;
        hasNullGuard = hasNullGuard || scan.hasNullGuard;
      }
      if (!hasThrowingDereference || hasNullGuard) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
