import type { EsTreeNode } from "../ast/es-tree-node.js";
import { forEachChildNode } from "../ast/for-each-child-node.js";
import { isAstNode } from "../ast/is-ast-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";
import type { BasicBlock } from "../ir/basic-block.js";
import { addEdge, createBlock, mapDescendantsToBlock, setTerminal } from "./cfg-builder.js";
import type { CfgBuilder } from "./cfg-builder.js";

const LOGICAL_ASSIGNMENT_OPERATORS = new Set(["&&=", "||=", "??="]);

export const isLogicalAssignment = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "AssignmentExpression") &&
  LOGICAL_ASSIGNMENT_OPERATORS.has((node as { operator: string }).operator);

// True when an expression subtree contains short-circuiting control flow
// we model as branches: a ternary, a `&&` / `||` / `??`, or a logical
// assignment (`&&=` / `||=` / `??=`). Stops at nested function boundaries —
// those get their own CFG. Lets `buildStatement` keep the cheap
// `mapDescendantsToBlock` path for straight-line code and only pay the
// block-splitting cost when an expression actually branches.
export const containsExpressionControlFlow = (node: EsTreeNode): boolean => {
  let found = false;
  const visit = (current: EsTreeNode): void => {
    if (found) return;
    if (
      isNodeOfType(current, "ConditionalExpression") ||
      isNodeOfType(current, "LogicalExpression") ||
      isNodeOfType(current, "ChainExpression") ||
      isLogicalAssignment(current)
    ) {
      found = true;
      return;
    }
    if (isFunctionLike(current)) return;
    forEachChildNode(current, visit);
  };
  visit(node);
  return found;
};

// Lower an expression's embedded control flow into the CFG — mirroring how
// the React Compiler's HIR (and oxc_cfg) give a ternary's arms, a logical
// operator's right operand, and a logical assignment's right operand their
// own basic blocks. A hook / setState / effect nested in any of those is
// then correctly seen as CONDITIONAL (short-circuited on some path), which
// statement-level lowering alone cannot see. Returns — and maps the node to
// — the block where its value becomes available (its join): a node's effect
// happens AFTER its operands, so a `wrap(cond ? a : b)` call lands in the
// post-arms block, not the pre-test one. Never descends into nested
// functions (they get their own CFG).
export const buildExpression = (
  builder: CfgBuilder,
  node: EsTreeNode | null | undefined,
  current: BasicBlock,
): BasicBlock => {
  if (!node) return current;
  if (isFunctionLike(node)) {
    builder.nodeBlock.set(node, current);
    return current;
  }

  if (isNodeOfType(node, "ConditionalExpression")) {
    const afterTest = buildExpression(builder, node.test as EsTreeNode, current);
    const consequentBlock = createBlock(builder);
    const alternateBlock = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(afterTest, consequentBlock, "cond");
    addEdge(afterTest, alternateBlock, "cond");
    setTerminal(afterTest, { kind: "ternary", fallthrough: merge });
    const consequentEnd = buildExpression(builder, node.consequent as EsTreeNode, consequentBlock);
    const alternateEnd = buildExpression(builder, node.alternate as EsTreeNode, alternateBlock);
    addEdge(consequentEnd, merge, "uncond");
    addEdge(alternateEnd, merge, "uncond");
    builder.nodeBlock.set(node, merge);
    return merge;
  }

  if (isNodeOfType(node, "LogicalExpression") || isLogicalAssignment(node)) {
    // The left/target operand is always evaluated; the right operand is
    // conditional (short-circuited). From the post-left block one successor
    // evaluates the RHS and one skips straight to the join.
    const afterLeft = buildExpression(builder, (node as { left: EsTreeNode }).left, current);
    const rightBlock = createBlock(builder);
    const merge = createBlock(builder);
    addEdge(afterLeft, rightBlock, "cond");
    addEdge(afterLeft, merge, "cond");
    setTerminal(afterLeft, { kind: "logical", fallthrough: merge });
    const rightEnd = buildExpression(builder, (node as { right: EsTreeNode }).right, rightBlock);
    addEdge(rightEnd, merge, "uncond");
    builder.nodeBlock.set(node, merge);
    return merge;
  }

  if (isNodeOfType(node, "ChainExpression")) {
    // Optional chain (`a?.b.c?.()`). The React Compiler models this with a
    // SINGLE shared short-circuit target: any nullish optional link jumps to
    // the same continuation (value = undefined). Everything to the right of
    // a `?.` is conditional; the chain value is available at `merge`, where
    // the short-circuit and the fully-evaluated paths rejoin.
    const merge = createBlock(builder);
    const chainEnd = buildOptionalChainLink(
      builder,
      (node as { expression: EsTreeNode }).expression,
      current,
      merge,
    );
    addEdge(chainEnd, merge, "uncond");
    builder.nodeBlock.set(node, merge);
    return merge;
  }

  // Generic expression: evaluate children left-to-right, threading the
  // block so a control-flow child splits the siblings that follow it. The
  // node itself completes in the final cursor block.
  let cursor = current;
  forEachChildNode(node, (child) => {
    cursor = buildExpression(builder, child, cursor);
  });
  builder.nodeBlock.set(node, cursor);
  return cursor;
};

// Lower one link of an optional chain in evaluation order (innermost
// object/callee first), branching to the shared `merge` (short-circuit) at
// each optional `?.`. Mirrors the compiler's `lowerOptional*Expression`:
// the base is evaluated unconditionally, then anything to the right of the
// `?.` — a computed property, a deeper access, or a call's arguments —
// evaluates in the conditional continuation. Returns the block where this
// link's value is available on the non-short-circuit path.
const buildOptionalChainLink = (
  builder: CfgBuilder,
  node: EsTreeNode,
  current: BasicBlock,
  merge: BasicBlock,
): BasicBlock => {
  if (isNodeOfType(node, "MemberExpression")) {
    const afterObject = buildOptionalChainLink(builder, node.object as EsTreeNode, current, merge);
    let cursor = afterObject;
    if ((node as { optional?: boolean }).optional) {
      const continuation = createBlock(builder);
      addEdge(afterObject, continuation, "cond"); // base non-nullish → continue
      addEdge(afterObject, merge, "cond"); // base nullish → short-circuit
      setTerminal(afterObject, { kind: "optional", fallthrough: merge });
      cursor = continuation;
    }
    // A computed key (`a?.[expr]`) is only evaluated once the base is known
    // non-nullish, so it belongs in the post-branch continuation.
    if ((node as { computed?: boolean }).computed) {
      cursor = buildExpression(builder, node.property as EsTreeNode, cursor);
    }
    builder.nodeBlock.set(node, cursor);
    return cursor;
  }

  if (isNodeOfType(node, "CallExpression")) {
    const afterCallee = buildOptionalChainLink(builder, node.callee as EsTreeNode, current, merge);
    let cursor = afterCallee;
    if ((node as { optional?: boolean }).optional) {
      const continuation = createBlock(builder);
      addEdge(afterCallee, continuation, "cond");
      addEdge(afterCallee, merge, "cond");
      setTerminal(afterCallee, { kind: "optional", fallthrough: merge });
      cursor = continuation;
    }
    for (const argument of (node as { arguments: ReadonlyArray<EsTreeNode> }).arguments) {
      if (isAstNode(argument)) cursor = buildExpression(builder, argument, cursor);
    }
    builder.nodeBlock.set(node, cursor);
    return cursor;
  }

  // Chain base (an identifier, a parenthesized expression, a non-optional
  // sub-expression): evaluate it normally.
  return buildExpression(builder, node, current);
};

// Evaluate a sub-expression in `current`, returning the block where its
// value is available. Falls back to the cheap whole-subtree mapping when
// the expression has no embedded control flow.
export const buildSubExpression = (
  builder: CfgBuilder,
  node: EsTreeNode | null | undefined,
  current: BasicBlock,
): BasicBlock => {
  if (!node) return current;
  if (containsExpressionControlFlow(node)) return buildExpression(builder, node, current);
  mapDescendantsToBlock(builder, node, current);
  return current;
};
