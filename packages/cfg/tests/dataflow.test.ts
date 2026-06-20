import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../src/control-flow-graph.js";
import { solveDataflow } from "../src/dataflow/solve.js";
import type { Lattice } from "../src/dataflow/lattice.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { parseFixture } from "./parse-fixture.js";
import { analyzeDataflowFixture } from "./run-dataflow.js";

// Layer A — the generic monotone dataflow solver and the definite-assignment
// analysis built on it.

const cfgOfProgram = (code: string) => {
  const parsed = parseFixture(code);
  attachParentReferences(parsed.program);
  const cfg = analyzeControlFlow(parsed.program).cfgFor(parsed.program);
  if (!cfg) throw new Error("program has no CFG");
  return cfg;
};

describe("solveDataflow / generic worklist", () => {
  // A toy reachability lattice: fact = "is this block reachable from entry".
  // join = OR, bottom = false (unreached), boundary = true at the entry.
  const reachableLattice: Lattice<boolean> = {
    bottom: false,
    join: (left, right) => left || right,
    equals: (left, right) => left === right,
  };

  it("propagates the boundary fact to every reachable block", () => {
    const cfg = cfgOfProgram(`
      const a = 1;
      const b = 2;
      const c = a + b;
    `);
    const result = solveDataflow<boolean>({
      cfg,
      lattice: reachableLattice,
      direction: "forward",
      boundary: true,
      transfer: (_block, incoming) => incoming,
    });
    for (const block of cfg.blocks) {
      if (block === cfg.entry) continue;
      // Every block on a straight-line program is reachable.
      const reachableFromEntry = cfg.entry === block || result.entryFactOf(block);
      expect(reachableFromEntry).toBe(true);
    }
  });

  it("reaches a fixpoint over a loop (back-edge does not diverge)", () => {
    const cfg = cfgOfProgram(`
      let total = 0;
      for (let index = 0; index < 10; index++) {
        total += index;
      }
      use(total);
    `);
    const result = solveDataflow<boolean>({
      cfg,
      lattice: reachableLattice,
      direction: "forward",
      boundary: true,
      transfer: (_block, incoming) => incoming,
    });
    // Termination is the property under test; the exit must be reachable.
    expect(result.entryFactOf(cfg.exit)).toBe(true);
  });

  it("supports backward flow (liveness-shaped)", () => {
    const cfg = cfgOfProgram(`
      const a = 1;
      use(a);
    `);
    // A trivial backward analysis: "can this block reach the exit". join = OR,
    // boundary = true at the exit; every block in straight-line code can.
    const result = solveDataflow<boolean>({
      cfg,
      lattice: reachableLattice,
      direction: "backward",
      boundary: true,
      transfer: (_block, incoming) => incoming,
    });
    expect(result.exitFactOf(cfg.entry)).toBe(true);
  });
});

describe("analyzeDefiniteAssignment", () => {
  it("a let read after an unconditional write is definitely assigned", () => {
    const fixture = analyzeDataflowFixture(`
      function f() {
        let x = 1;
        return x;
      }
    `);
    // The read of x in `return x` (second occurrence).
    expect(fixture.definiteAssignment.isMaybeUnassignedAt(fixture.identifier("x#2"))).toBe(false);
  });

  it("a let written on only one branch is maybe-unassigned at the join read", () => {
    const fixture = analyzeDataflowFixture(`
      function f(c) {
        let x;
        if (c) {
          x = 1;
        }
        return x;
      }
    `);
    // x#1 declaration, x#2 the conditional write, x#3 the read.
    expect(fixture.definiteAssignment.isMaybeUnassignedAt(fixture.identifier("x#3"))).toBe(true);
  });

  it("a let written on both branches is definitely assigned at the join", () => {
    const fixture = analyzeDataflowFixture(`
      function f(c) {
        let x;
        if (c) {
          x = 1;
        } else {
          x = 2;
        }
        return x;
      }
    `);
    expect(fixture.definiteAssignment.isMaybeUnassignedAt(fixture.identifier("x#4"))).toBe(false);
  });

  it("a write earlier in the same block satisfies a later read", () => {
    const fixture = analyzeDataflowFixture(`
      function f() {
        let x;
        x = 1;
        return x;
      }
    `);
    expect(fixture.definiteAssignment.isMaybeUnassignedAt(fixture.identifier("x#3"))).toBe(false);
  });

  it("a read before any write is maybe-unassigned", () => {
    const fixture = analyzeDataflowFixture(`
      function f() {
        let x;
        const y = x;
        x = 1;
        return y;
      }
    `);
    // x#2 is the read in `const y = x` before x is ever written.
    expect(fixture.definiteAssignment.isMaybeUnassignedAt(fixture.identifier("x#2"))).toBe(true);
  });
});

// Layer D — path feasibility refines definite-assignment: a read whose only
// unassigned path can't execute is not reported.
describe("analyzeDefiniteAssignment / path-feasibility refinement", () => {
  const correlated = `
    function f(c) {
      let x;
      if (c) {
        x = 1;
      }
      if (c) {
        return x;
      }
    }
  `;

  it("flags the correlated read WITHOUT feasibility (path-insensitive)", () => {
    const fixture = analyzeDataflowFixture(correlated);
    expect(fixture.definiteAssignment.isMaybeUnassignedAt(fixture.identifier("x#3"))).toBe(true);
  });

  it("suppresses the correlated read WITH feasibility", () => {
    const fixture = analyzeDataflowFixture(correlated);
    // Reaching `return x` (guard `c`) without the write (also guard `c`) needs
    // `c` falsy then truthy — provably infeasible.
    expect(
      fixture.definiteAssignmentWithFeasibility.isMaybeUnassignedAt(fixture.identifier("x#3")),
    ).toBe(false);
  });

  it("keeps the read flagged when the guards are independent", () => {
    const fixture = analyzeDataflowFixture(`
      function f(c, d) {
        let x;
        if (c) {
          x = 1;
        }
        if (d) {
          return x;
        }
      }
    `);
    expect(
      fixture.definiteAssignmentWithFeasibility.isMaybeUnassignedAt(fixture.identifier("x#3")),
    ).toBe(true);
  });

  it("never suppresses a genuinely-unconditional unassigned read", () => {
    const fixture = analyzeDataflowFixture(`
      function f() {
        let x;
        return x;
      }
    `);
    expect(
      fixture.definiteAssignmentWithFeasibility.isMaybeUnassignedAt(fixture.identifier("x#2")),
    ).toBe(true);
  });
});
