import type { EsTreeNode } from "./ast/es-tree-node.js";
import { forEachChildNode } from "./ast/for-each-child-node.js";
import { isFunctionLike } from "./ast/is-function-like.js";
import { isNodeOfType } from "./ast/is-node-of-type.js";
import { computeCyclicBlocks } from "./analysis/loops.js";
import { computeDominatorTree, computePostDominatorTree } from "./analysis/dominators.js";
import type { DominatorTree } from "./analysis/dominators.js";
import { computeNodeOrder } from "./analysis/node-order.js";
import { computeReachableFromEntry, isBlockReachableFromBlock } from "./analysis/reachability.js";
import { computeUnconditionalSet } from "./analysis/unconditional.js";
import { buildFunctionCfg } from "./build/build-function-cfg.js";
import { isConstantTruthyTest } from "./constant-condition.js";
import { cfgToDot } from "./dot.js";
import type { BasicBlock, FunctionCfg } from "./ir/basic-block.js";

export type { BasicBlock, CfgEdge, CfgEdgeKind, FunctionCfg } from "./ir/basic-block.js";
export type { Instruction, InstructionKind } from "./ir/instruction.js";
export type { GotoVariant, Terminal, TerminalCase } from "./ir/terminal.js";
export type { DominatorTree } from "./analysis/dominators.js";
export { cfgToDot } from "./dot.js";

export interface ControlFlowAnalysis {
  readonly cfgFor: (functionLike: EsTreeNode) => FunctionCfg | null;
  readonly enclosingFunction: (node: EsTreeNode) => EsTreeNode | null;
  // On every path from the enclosing function's entry to its exit.
  readonly isUnconditionalFromEntry: (node: EsTreeNode) => boolean;
  // Some control-flow path lets execution flow from `fromNode` to
  // `toNode` within the same enclosing function. Cross-function pairs
  // are never reachable.
  readonly isReachable: (fromNode: EsTreeNode, toNode: EsTreeNode) => boolean;
  // `aNode` executes on EVERY path that reaches `bNode` (graph
  // dominance). A guard that dominates a sink runs before it on every
  // path.
  readonly dominates: (aNode: EsTreeNode, bNode: EsTreeNode) => boolean;
  // `bNode` executes on EVERY path from `aNode` to the function exit
  // (graph post-dominance). A cleanup that post-dominates a
  // subscription always runs after it.
  readonly postDominates: (bNode: EsTreeNode, aNode: EsTreeNode) => boolean;
  // The node's basic block is part of a cycle in ITS OWN function's CFG
  // — i.e. it executes once per iteration of an enclosing loop. A node
  // inside a callback that merely escapes a loop is NOT inside the loop
  // (the callback is a separate function with its own acyclic CFG).
  readonly isInsideLoop: (node: EsTreeNode) => boolean;
  // The node's block is not reachable from the function entry (dead
  // code after an unconditional return / throw / break).
  readonly isUnreachable: (node: EsTreeNode) => boolean;
  // The dominance frontier of the node's basic block (Cytron et al.) —
  // the join points where the node's dominance ends. Exposed raw as the
  // SSA-construction seam; returns [] for an unreachable / unknown node.
  readonly dominanceFrontier: (node: EsTreeNode) => BasicBlock[];
  // The loop statement's test is a compile-time truthy constant (or absent
  // for `for (;;)`), so the loop never exits via its condition (oxc's
  // `is_infinite_loop_start`). False for non-loop nodes.
  readonly isInfiniteLoopStart: (node: EsTreeNode) => boolean;
  // Graphviz DOT of a function-like (or Program) node's CFG, for
  // debugging / parity snapshots. Null when the node has no CFG.
  readonly toDot: (functionLike: EsTreeNode) => string | null;
}

// Per-function analysis bundle. The CFG itself is built eagerly during
// the AST walk (cheap, and `blockOf` needs it for every lookup), but the
// six derived structures are each computed lazily on first access and
// memoized — a rule that only queries `isInsideLoop` pays for nothing but
// `cyclicBlocks`, never the dominator trees or the unconditional set.
interface FunctionCfgEntry {
  readonly cfg: FunctionCfg;
  readonly unconditionalSet: Set<BasicBlock>;
  readonly dominatorTree: DominatorTree;
  readonly postDominatorTree: DominatorTree;
  readonly cyclicBlocks: Set<BasicBlock>;
  readonly reachableFromEntry: Set<BasicBlock>;
  readonly nodeOrder: Map<EsTreeNode, number>;
}

const createFunctionCfgEntry = (functionNode: EsTreeNode, body: EsTreeNode): FunctionCfgEntry => {
  const cfg = buildFunctionCfg(functionNode, body);
  let unconditionalSet: Set<BasicBlock> | undefined;
  let dominatorTree: DominatorTree | undefined;
  let postDominatorTree: DominatorTree | undefined;
  let cyclicBlocks: Set<BasicBlock> | undefined;
  let reachableFromEntry: Set<BasicBlock> | undefined;
  let nodeOrder: Map<EsTreeNode, number> | undefined;
  return {
    cfg,
    get unconditionalSet() {
      return (unconditionalSet ??= computeUnconditionalSet(cfg));
    },
    get dominatorTree() {
      return (dominatorTree ??= computeDominatorTree(cfg.entry));
    },
    get postDominatorTree() {
      return (postDominatorTree ??= computePostDominatorTree(cfg.exit));
    },
    get cyclicBlocks() {
      return (cyclicBlocks ??= computeCyclicBlocks(cfg));
    },
    get reachableFromEntry() {
      return (reachableFromEntry ??= computeReachableFromEntry(cfg));
    },
    get nodeOrder() {
      return (nodeOrder ??= computeNodeOrder(functionNode, body));
    },
  };
};

// Walks the AST building a CFG for every function-like node + the
// program. Lookups for an arbitrary AST node find the enclosing
// function and consult that function's CFG.
export const analyzeControlFlow = (program: EsTreeNode): ControlFlowAnalysis => {
  const functionCfgs = new Map<EsTreeNode, FunctionCfgEntry>();

  const buildFor = (functionNode: EsTreeNode, body: EsTreeNode): void => {
    functionCfgs.set(functionNode, createFunctionCfgEntry(functionNode, body));
  };

  // Build CFG for the program itself (treat as a "function" for
  // top-level reasoning); buildFunctionCfg lowers a Program body in place.
  if (isNodeOfType(program, "Program")) {
    buildFor(program, program);
  }

  // Walk every function-like node, build its own CFG.
  const visit = (node: EsTreeNode): void => {
    if (isFunctionLike(node)) {
      const body = (node as { body: EsTreeNode }).body;
      if (body) buildFor(node, body);
    }
    forEachChildNode(node, visit);
  };
  visit(program);

  // Walking the parent chain is O(depth) and the same node is queried
  // repeatedly across the locate/dominates/postDominates primitives, so
  // memoize the result per node. The CFG is immutable after construction.
  const enclosingFunctionCache = new WeakMap<EsTreeNode, EsTreeNode | null>();

  const enclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
    const cached = enclosingFunctionCache.get(node);
    if (cached !== undefined) return cached;
    let current: EsTreeNode | null | undefined = node;
    while (current) {
      if (isFunctionLike(current)) break;
      if (isNodeOfType(current, "Program")) break;
      current = current.parent ?? null;
    }
    const owner = current ?? null;
    enclosingFunctionCache.set(node, owner);
    return owner;
  };

  const cfgFor = (functionLike: EsTreeNode): FunctionCfg | null => {
    return functionCfgs.get(functionLike)?.cfg ?? null;
  };

  const isUnconditionalFromEntry = (node: EsTreeNode): boolean => {
    const owner = enclosingFunction(node);
    if (!owner) return true;
    const entry = functionCfgs.get(owner);
    if (!entry) return true;
    const block = entry.cfg.blockOf(node);
    if (!block) return true;
    return entry.unconditionalSet.has(block);
  };

  interface LocatedNode {
    owner: EsTreeNode;
    entry: FunctionCfgEntry;
    block: BasicBlock;
  }

  const locate = (node: EsTreeNode): LocatedNode | null => {
    const owner = enclosingFunction(node);
    if (!owner) return null;
    const entry = functionCfgs.get(owner);
    if (!entry) return null;
    const block = entry.cfg.blockOf(node);
    if (!block) return null;
    return { owner, entry, block };
  };

  const isReachable = (fromNode: EsTreeNode, toNode: EsTreeNode): boolean => {
    const from = locate(fromNode);
    const to = locate(toNode);
    if (!from || !to || from.owner !== to.owner) return false;
    if (from.block === to.block) {
      if (from.entry.cyclicBlocks.has(from.block)) return true;
      const fromOrder = from.entry.nodeOrder.get(fromNode) ?? 0;
      const toOrder = to.entry.nodeOrder.get(toNode) ?? 0;
      return fromOrder <= toOrder;
    }
    return isBlockReachableFromBlock(from.block, to.block);
  };

  const dominates = (aNode: EsTreeNode, bNode: EsTreeNode): boolean => {
    const dominator = locate(aNode);
    const dominated = locate(bNode);
    if (!dominator || !dominated || dominator.owner !== dominated.owner) return false;
    if (dominator.block === dominated.block) {
      const aOrder = dominator.entry.nodeOrder.get(aNode) ?? 0;
      const bOrder = dominated.entry.nodeOrder.get(bNode) ?? 0;
      return aOrder <= bOrder;
    }
    return dominated.entry.dominatorTree.dominates(dominator.block, dominated.block);
  };

  const postDominates = (bNode: EsTreeNode, aNode: EsTreeNode): boolean => {
    const postDominator = locate(bNode);
    const postDominated = locate(aNode);
    if (!postDominator || !postDominated || postDominator.owner !== postDominated.owner) {
      return false;
    }
    if (postDominator.block === postDominated.block) {
      const bOrder = postDominator.entry.nodeOrder.get(bNode) ?? 0;
      const aOrder = postDominated.entry.nodeOrder.get(aNode) ?? 0;
      return bOrder >= aOrder;
    }
    return postDominated.entry.postDominatorTree.dominates(
      postDominator.block,
      postDominated.block,
    );
  };

  const isInsideLoop = (node: EsTreeNode): boolean => {
    const located = locate(node);
    if (!located) return false;
    return located.entry.cyclicBlocks.has(located.block);
  };

  const isUnreachable = (node: EsTreeNode): boolean => {
    const located = locate(node);
    if (!located) return false;
    return !located.entry.reachableFromEntry.has(located.block);
  };

  const dominanceFrontier = (node: EsTreeNode): BasicBlock[] => {
    const located = locate(node);
    if (!located) return [];
    return [...located.entry.dominatorTree.dominanceFrontierOf(located.block)];
  };

  const isInfiniteLoopStart = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "ForStatement")) {
      return isConstantTruthyTest((node.test as EsTreeNode | null) ?? null);
    }
    if (isNodeOfType(node, "WhileStatement") || isNodeOfType(node, "DoWhileStatement")) {
      return isConstantTruthyTest(node.test as EsTreeNode);
    }
    return false;
  };

  const toDot = (functionLike: EsTreeNode): string | null => {
    const cfg = cfgFor(functionLike);
    return cfg ? cfgToDot(cfg) : null;
  };

  return {
    cfgFor,
    enclosingFunction,
    isUnconditionalFromEntry,
    isReachable,
    dominates,
    postDominates,
    isInsideLoop,
    isUnreachable,
    dominanceFrontier,
    isInfiniteLoopStart,
    toDot,
  };
};
