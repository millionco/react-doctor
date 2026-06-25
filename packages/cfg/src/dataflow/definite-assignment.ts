import type { EsTreeNode } from "../ast/es-tree-node.js";
import { enumerateFunctions } from "../analysis/enumerate-functions.js";
import { collectPlacesByBlock } from "../analysis/places-by-block.js";
import { analyzeControlFlow } from "../control-flow-graph.js";
import type { ControlFlowAnalysis } from "../control-flow-graph.js";
import type { BasicBlock } from "../ir/basic-block.js";
import type { BindingId, Place, ResolveBinding } from "../ir/place.js";
import { createLexicalBindingResolver } from "../analysis/lexical-binding-resolver.js";
import { enumerateSimplePaths } from "../path/enumerate-paths.js";
import type { ResolveValueAtom } from "../path/path-condition.js";
import { everyCounterexampleInfeasible } from "../path/prune-infeasible.js";
import type { Lattice } from "./lattice.js";
import { solveDataflow } from "./solve.js";

// Definite-assignment over the SSA occurrence stream: at each binding read,
// is the binding guaranteed to have been written on EVERY path from the
// function entry to that read? A "no" is a possibly-unassigned read — the
// signal a TDZ / read-before-write rule keys off. This is a forward MUST
// analysis: a binding is definitely assigned at a merge only if assigned on
// all predecessors (set intersection at joins). Built on the generic
// `solveDataflow` worklist.
export interface DefiniteAssignmentAnalysis {
  // `node` is a binding read that some entry→read path reaches without a
  // prior write of that binding. Unknown / unreachable reads answer `false`
  // (we only ever report a provable maybe-unassigned).
  readonly isMaybeUnassignedAt: (node: EsTreeNode) => boolean;
}

export interface DefiniteAssignmentOptions {
  // Layer D refinement (opt-in): when supplied, a read is reported only if at
  // least one of its unassigned paths is not provably infeasible. Maps a test
  // identifier to its abstract atom (the caller keys it by `ssa.versionAt` so
  // correlated branches collapse to one atom).
  readonly resolveValue?: ResolveValueAtom;
  // Optional prebuilt CFG. When the caller already has one (the oxlint plugin
  // shares a single CFG across cfg/ssa/dataflow per file), pass it so this
  // analysis does not rebuild it. Omitting it preserves the original behavior.
  readonly controlFlow?: ControlFlowAnalysis;
}

// The set of bindings definitely assigned so far, or `top` for a block not
// yet reached by the worklist (the join identity — intersecting with it is
// a no-op, so an unprocessed predecessor never falsely constrains a join).
type AssignedFact = ReadonlySet<BindingId> | "top";

const intersect = (left: ReadonlySet<BindingId>, right: ReadonlySet<BindingId>): Set<BindingId> => {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  const result = new Set<BindingId>();
  for (const binding of smaller) {
    if (larger.has(binding)) result.add(binding);
  }
  return result;
};

const setsEqual = (left: ReadonlySet<BindingId>, right: ReadonlySet<BindingId>): boolean => {
  if (left.size !== right.size) return false;
  for (const binding of left) {
    if (!right.has(binding)) return false;
  }
  return true;
};

const assignedLattice: Lattice<AssignedFact> = {
  bottom: "top",
  join: (left, right) => {
    if (left === "top") return right;
    if (right === "top") return left;
    return intersect(left, right);
  },
  equals: (left, right) => {
    if (left === "top" || right === "top") return left === right;
    return setsEqual(left, right);
  },
};

const writeBindingsByBlock = (
  placesByBlock: ReadonlyMap<BasicBlock, ReadonlyArray<Place>>,
): Map<BasicBlock, Set<BindingId>> => {
  const writesByBlock = new Map<BasicBlock, Set<BindingId>>();
  for (const [block, places] of placesByBlock) {
    const writes = new Set<BindingId>();
    for (const place of places) {
      if (place.kind === "write") writes.add(place.binding);
    }
    if (writes.size > 0) writesByBlock.set(block, writes);
  }
  return writesByBlock;
};

export const analyzeDefiniteAssignment = (
  program: EsTreeNode,
  resolveBinding: ResolveBinding = createLexicalBindingResolver(program),
  options: DefiniteAssignmentOptions = {},
): DefiniteAssignmentAnalysis => {
  const controlFlow = options.controlFlow ?? analyzeControlFlow(program);
  const maybeUnassignedByNode = new Map<EsTreeNode, boolean>();
  const { resolveValue } = options;

  for (const owner of enumerateFunctions(program)) {
    const cfg = controlFlow.cfgFor(owner);
    if (!cfg) continue;
    const placesByBlock = collectPlacesByBlock(cfg, owner, resolveBinding);
    const writesByBlock = writeBindingsByBlock(placesByBlock);

    // Layer D: a flagged read is a false positive iff every entry→read path
    // that skips all of the binding's writes is provably infeasible. Memoized
    // by (binding, block): every read of the same binding in one block shares
    // the same path enumeration, so it runs once rather than per read.
    const infeasibleByBindingBlock = new Map<string, boolean>();
    const everyUnassignedPathInfeasible = (readBlock: BasicBlock, binding: BindingId): boolean => {
      if (!resolveValue) return false;
      const cacheKey = `${binding}@${readBlock.id}`;
      const cached = infeasibleByBindingBlock.get(cacheKey);
      if (cached !== undefined) return cached;
      const writeBlocks = new Set<BasicBlock>();
      for (const [candidate, writes] of writesByBlock) {
        if (writes.has(binding)) writeBlocks.add(candidate);
      }
      const result = enumerateSimplePaths({
        start: cfg.entry,
        isGoal: (block) => block === readBlock,
        canTraverse: (block) => !writeBlocks.has(block),
      });
      const infeasible = everyCounterexampleInfeasible(result, resolveValue);
      infeasibleByBindingBlock.set(cacheKey, infeasible);
      return infeasible;
    };

    const result = solveDataflow<AssignedFact>({
      cfg,
      lattice: assignedLattice,
      direction: "forward",
      // Nothing is assigned at the function entry.
      boundary: new Set<BindingId>(),
      transfer: (block, incoming) => {
        if (incoming === "top") return "top";
        const writes = writesByBlock.get(block);
        if (!writes) return incoming;
        const out = new Set(incoming);
        for (const binding of writes) out.add(binding);
        return out;
      },
    });

    // Resolve each read at its exact occurrence point: the block-entry fact
    // plus the writes that precede it within the same block.
    for (const [block, places] of placesByBlock) {
      const entryFact = result.entryFactOf(block);
      // An unreachable block (never assigned a real fact) has no live read.
      if (entryFact === "top") continue;
      const assigned = new Set(entryFact);
      for (const place of places) {
        if (place.kind === "write") {
          assigned.add(place.binding);
          continue;
        }
        // A `declare` neither assigns nor reads; only a real read can be
        // possibly-unassigned.
        if (place.kind === "read" && !assigned.has(place.binding)) {
          if (everyUnassignedPathInfeasible(block, place.binding)) continue;
          maybeUnassignedByNode.set(place.node, true);
        }
      }
    }
  }

  return {
    isMaybeUnassignedAt: (node) => maybeUnassignedByNode.get(node) ?? false,
  };
};
