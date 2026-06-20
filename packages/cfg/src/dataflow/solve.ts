import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";
import { predecessorBlocks, successorBlocks } from "../analysis/block-edges.js";
import { reversePostorder } from "../analysis/reverse-postorder.js";
import type { Lattice } from "./lattice.js";

export type DataflowDirection = "forward" | "backward";

export interface DataflowSpec<Fact> {
  readonly cfg: FunctionCfg;
  readonly lattice: Lattice<Fact>;
  readonly direction: DataflowDirection;
  // The fact at the graph's open end: the entry's in-fact (forward) or the
  // exit's out-fact (backward).
  readonly boundary: Fact;
  // The block's effect on a fact flowing through it, in the analysis
  // direction: forward maps the in-fact to the out-fact; backward maps the
  // out-fact to the in-fact.
  readonly transfer: (block: BasicBlock, incoming: Fact) => Fact;
}

export interface DataflowResult<Fact> {
  // The fact holding at each block's entry / exit (source-order ends,
  // regardless of analysis direction).
  readonly entryFactOf: (block: BasicBlock) => Fact;
  readonly exitFactOf: (block: BasicBlock) => Fact;
}

// A generic monotone dataflow solver: iterate the transfer functions over a
// reverse-postorder sweep until the fact assignment reaches a fixpoint.
// Forward analyses flow over successors from the entry; backward analyses
// flow over predecessors from the exit. The same RPO-to-fixpoint shape the
// dominator solver uses (`analysis/dominators.ts`), generalized over an
// arbitrary `Lattice`. This is the engine the definite-assignment and
// typestate analyses are built on.
export const solveDataflow = <Fact>(spec: DataflowSpec<Fact>): DataflowResult<Fact> => {
  const { cfg, lattice, direction, boundary, transfer } = spec;
  const isForward = direction === "forward";

  // The "incoming" relation we join over, and the open-end block whose
  // incoming fact is the boundary rather than a join of neighbors.
  const root = isForward ? cfg.entry : cfg.exit;
  const incomingNeighbors = isForward ? predecessorBlocks : successorBlocks;
  const order = reversePostorder(root, isForward ? successorBlocks : predecessorBlocks);

  // incoming[block] = fact flowing into the block along the analysis
  // direction; outgoing[block] = transfer(block, incoming[block]).
  const incoming = new Map<BasicBlock, Fact>();
  const outgoing = new Map<BasicBlock, Fact>();
  for (const block of order) {
    incoming.set(block, lattice.bottom);
    outgoing.set(block, lattice.bottom);
  }

  const reachable = new Set(order);
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of order) {
      let incomingFact = block === root ? boundary : lattice.bottom;
      for (const neighbor of incomingNeighbors(block)) {
        if (!reachable.has(neighbor)) continue;
        incomingFact = lattice.join(incomingFact, outgoing.get(neighbor)!);
      }
      incoming.set(block, incomingFact);
      const outgoingFact = transfer(block, incomingFact);
      if (!lattice.equals(outgoing.get(block)!, outgoingFact)) {
        outgoing.set(block, outgoingFact);
        changed = true;
      }
    }
  }

  // Map the direction-relative facts back to source-order entry/exit.
  const entryFactOf = (block: BasicBlock): Fact =>
    (isForward ? incoming.get(block) : outgoing.get(block)) ?? lattice.bottom;
  const exitFactOf = (block: BasicBlock): Fact =>
    (isForward ? outgoing.get(block) : incoming.get(block)) ?? lattice.bottom;

  return { entryFactOf, exitFactOf };
};
