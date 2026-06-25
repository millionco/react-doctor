import type { SimplifiableExpressionKind } from "../types.js";
import {
  MAX_EXPRESSION_DETECTOR_WALK_DEPTH,
  SIMPLIFIABLE_EXPRESSION_MEMBER_ACCESS_DEPTH,
} from "../constants.js";
import { isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface SimplifiableExpressionCapture {
  kind: SimplifiableExpressionKind;
  snippet: string;
  startOffset: number;
  reason: string;
  suggestion: string;
}

const memberAccessText = (node: OxcAstNode, depth = 0): string | undefined => {
  if (depth > SIMPLIFIABLE_EXPRESSION_MEMBER_ACCESS_DEPTH) return undefined;
  if (node.type === "Identifier") return (node as { name?: string }).name;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "MemberExpression") {
    const computed = (node as { computed?: boolean }).computed;
    if (computed) return undefined;
    const objectNode = (node as { object?: OxcAstNode }).object;
    const propertyNode = (node as { property?: OxcAstNode }).property;
    if (!objectNode || !propertyNode) return undefined;
    const objectText = memberAccessText(objectNode, depth + 1);
    const propertyText =
      propertyNode.type === "Identifier" ? (propertyNode as { name?: string }).name : undefined;
    if (!objectText || !propertyText) return undefined;
    return `${objectText}.${propertyText}`;
  }
  return undefined;
};

const isBooleanLiteral = (node: OxcAstNode, expected: boolean): boolean => {
  if (node.type !== "Literal") return false;
  return (node as { value?: unknown }).value === expected;
};

const detectSelfFallbackTernary = (
  conditionalNode: OxcAstNode,
): SimplifiableExpressionCapture | undefined => {
  if (conditionalNode.type !== "ConditionalExpression") return undefined;
  const testNode = (conditionalNode as { test?: OxcAstNode }).test;
  const consequentNode = (conditionalNode as { consequent?: OxcAstNode }).consequent;
  if (!testNode || !consequentNode) return undefined;
  const testText = memberAccessText(testNode);
  const consequentText = memberAccessText(consequentNode);
  if (!testText || !consequentText) return undefined;
  if (testText !== consequentText) return undefined;
  return {
    kind: "self-fallback-ternary",
    snippet: `${testText} ? ${consequentText} : ...`,
    startOffset: conditionalNode.start ?? 0,
    reason: `\`${testText} ? ${testText} : x\` is a self-fallback ternary`,
    suggestion: `use \`${testText} ?? x\` (nullish-only) or \`${testText} || x\` (falsy fallback) depending on intent`,
  };
};

const detectTernaryReturnsBoolean = (
  conditionalNode: OxcAstNode,
): SimplifiableExpressionCapture | undefined => {
  if (conditionalNode.type !== "ConditionalExpression") return undefined;
  const consequentNode = (conditionalNode as { consequent?: OxcAstNode }).consequent;
  const alternateNode = (conditionalNode as { alternate?: OxcAstNode }).alternate;
  if (!consequentNode || !alternateNode) return undefined;
  const isTrueFalse =
    isBooleanLiteral(consequentNode, true) && isBooleanLiteral(alternateNode, false);
  const isFalseTrue =
    isBooleanLiteral(consequentNode, false) && isBooleanLiteral(alternateNode, true);
  if (!isTrueFalse && !isFalseTrue) return undefined;
  return {
    kind: "ternary-returns-boolean",
    snippet: isTrueFalse ? "cond ? true : false" : "cond ? false : true",
    startOffset: conditionalNode.start ?? 0,
    reason: isTrueFalse
      ? "`cond ? true : false` collapses to `Boolean(cond)`"
      : "`cond ? false : true` collapses to `!cond`",
    suggestion: isTrueFalse
      ? "replace with `Boolean(cond)` or just `cond` when types match"
      : "replace with `!cond`",
  };
};

const isNullLiteral = (node: OxcAstNode): boolean =>
  node.type === "Literal" && (node as { value?: unknown }).value === null;

const isUndefinedIdentifier = (node: OxcAstNode): boolean =>
  node.type === "Identifier" && (node as { name?: string }).name === "undefined";

const detectNullishCoalescingWithNullish = (
  logicalNode: OxcAstNode,
): SimplifiableExpressionCapture | undefined => {
  if (logicalNode.type !== "LogicalExpression") return undefined;
  if ((logicalNode as { operator?: string }).operator !== "??") return undefined;
  const rightNode = (logicalNode as { right?: OxcAstNode }).right;
  if (!rightNode) return undefined;
  const isNullish = isNullLiteral(rightNode) || isUndefinedIdentifier(rightNode);
  if (!isNullish) return undefined;
  const leftNode = (logicalNode as { left?: OxcAstNode }).left;
  const leftText = leftNode ? (memberAccessText(leftNode) ?? "expr") : "expr";
  const rightLabel = isNullLiteral(rightNode) ? "null" : "undefined";
  return {
    kind: "nullish-coalescing-with-nullish",
    snippet: `${leftText} ?? ${rightLabel}`,
    startOffset: logicalNode.start ?? 0,
    reason: `\`x ?? ${rightLabel}\` looks like a no-op — but may be intentional when a caller's signature requires \`${rightLabel}\` (PropTypes, form-control onChange, etc.)`,
    suggestion: `if \`x\` is already \`T | ${rightLabel}\`, drop the \`?? ${rightLabel}\`; otherwise keep — the coercion changes the resolved type`,
  };
};

const detectRedundantNullAndUndefinedCheck = (
  logicalNode: OxcAstNode,
): SimplifiableExpressionCapture | undefined => {
  if (logicalNode.type !== "LogicalExpression") return undefined;
  if ((logicalNode as { operator?: string }).operator !== "&&") return undefined;
  const leftNode = (logicalNode as { left?: OxcAstNode }).left;
  const rightNode = (logicalNode as { right?: OxcAstNode }).right;
  if (!leftNode || !rightNode) return undefined;
  if (leftNode.type !== "BinaryExpression" || rightNode.type !== "BinaryExpression")
    return undefined;
  const leftOp = (leftNode as { operator?: string }).operator;
  const rightOp = (rightNode as { operator?: string }).operator;
  if (leftOp !== "!==" || rightOp !== "!==") return undefined;
  const leftLeft = (leftNode as { left?: OxcAstNode }).left;
  const leftRight = (leftNode as { right?: OxcAstNode }).right;
  const rightLeft = (rightNode as { left?: OxcAstNode }).left;
  const rightRight = (rightNode as { right?: OxcAstNode }).right;
  if (!leftLeft || !leftRight || !rightLeft || !rightRight) return undefined;
  const leftLeftText = memberAccessText(leftLeft);
  const rightLeftText = memberAccessText(rightLeft);
  if (!leftLeftText || leftLeftText !== rightLeftText) return undefined;
  const leftRhsIsNull = isNullLiteral(leftRight);
  const leftRhsIsUndefined = isUndefinedIdentifier(leftRight);
  const rightRhsIsNull = isNullLiteral(rightRight);
  const rightRhsIsUndefined = isUndefinedIdentifier(rightRight);
  const coversBoth =
    (leftRhsIsNull && rightRhsIsUndefined) || (leftRhsIsUndefined && rightRhsIsNull);
  if (!coversBoth) return undefined;
  return {
    kind: "redundant-null-and-undefined-check",
    snippet: `${leftLeftText} !== null && ${leftLeftText} !== undefined`,
    startOffset: logicalNode.start ?? 0,
    reason: `\`x !== null && x !== undefined\` is equivalent to \`x != null\` (loose comparison checks both)`,
    suggestion: `replace with \`${leftLeftText} != null\``,
  };
};

const detectDoubleBangBoolean = (
  unaryNode: OxcAstNode,
): SimplifiableExpressionCapture | undefined => {
  if (unaryNode.type !== "UnaryExpression") return undefined;
  if ((unaryNode as { operator?: string }).operator !== "!") return undefined;
  const inner = (unaryNode as { argument?: OxcAstNode }).argument;
  if (!inner || inner.type !== "UnaryExpression") return undefined;
  if ((inner as { operator?: string }).operator !== "!") return undefined;
  const coerced = (inner as { argument?: OxcAstNode }).argument;
  if (!coerced) return undefined;
  const coercedText = memberAccessText(coerced) ?? "expr";
  return {
    kind: "double-bang-boolean",
    snippet: `!!${coercedText}`,
    startOffset: unaryNode.start ?? 0,
    reason: "`!!x` is a double-negation boolean coercion",
    suggestion: `replace with \`Boolean(${coercedText})\``,
  };
};

const visit = (
  node: OxcAstNode,
  captures: SimplifiableExpressionCapture[],
  depth: number,
): void => {
  if (depth > MAX_EXPRESSION_DETECTOR_WALK_DEPTH) return;

  const conditionalCapture = detectSelfFallbackTernary(node) ?? detectTernaryReturnsBoolean(node);
  if (conditionalCapture) captures.push(conditionalCapture);

  const doubleBangCapture = detectDoubleBangBoolean(node);
  if (doubleBangCapture) captures.push(doubleBangCapture);

  const logicalCapture =
    detectNullishCoalescingWithNullish(node) ?? detectRedundantNullAndUndefinedCheck(node);
  if (logicalCapture) captures.push(logicalCapture);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (isOxcAstNode(element)) visit(element, captures, depth + 1);
      }
    } else if (isOxcAstNode(value)) {
      visit(value, captures, depth + 1);
    }
  }
};

export const collectSimplifiableExpressions = (
  programBody: unknown[],
): SimplifiableExpressionCapture[] => {
  const captures: SimplifiableExpressionCapture[] = [];
  for (const statement of programBody) {
    if (isOxcAstNode(statement)) visit(statement, captures, 0);
  }
  return captures;
};
