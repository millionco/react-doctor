// A bounded join-semilattice: the abstract-domain contract a monotone
// dataflow analysis is parameterized over. `bottom` is the identity for
// `join` (the most-precise/uninitialized element the worklist seeds
// interior blocks with); `join` merges facts arriving from multiple
// control-flow predecessors (or successors, backward); `equals` is the
// fixpoint test. Implementations MUST make `join` monotone and the lattice
// finite-height so the worklist terminates.
export interface Lattice<Fact> {
  readonly bottom: Fact;
  readonly join: (left: Fact, right: Fact) => Fact;
  readonly equals: (left: Fact, right: Fact) => boolean;
}
