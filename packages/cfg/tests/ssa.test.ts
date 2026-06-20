import { describe, expect, it } from "vite-plus/test";
import {
  analyzeSsaFixture,
  assertPhiPlacementEqualsFrontier,
  assertPhisWithinDominanceFrontier,
} from "./run-ssa.js";

// SSA construction parity. The φ placement the Braun on-the-fly builder
// produces is checked against the classical iterated dominance frontier of
// each binding's definitions (Cytron et al.) — the strong, implementation-
// independent oracle for minimal SSA. Soundness (φ ⊆ frontier) holds on
// every fixture; completeness (φ == frontier) holds where the binding is
// live at every join, which these fixtures are built to guarantee.

describe("ssa / φ placement parity", () => {
  it("straight-line code needs no φ", () => {
    const fixture = analyzeSsaFixture(`
      function f() {
        let x = first();
        x = second();
        return x;
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    assertPhiPlacementEqualsFrontier(fixture, fixture.identifier("x"));
  });

  it("if/else join: one φ at the merge", () => {
    const fixture = analyzeSsaFixture(`
      function f(p) {
        let x = 1;
        if (p) {
          x = 2;
        } else {
          x = 3;
        }
        return x;
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    assertPhiPlacementEqualsFrontier(fixture, fixture.identifier("x"));
  });

  it("if without else: φ at the merge", () => {
    const fixture = analyzeSsaFixture(`
      function f(p) {
        let x = 1;
        if (p) {
          x = 2;
        }
        return x;
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    assertPhiPlacementEqualsFrontier(fixture, fixture.identifier("x"));
  });

  it("while loop: φ at the header", () => {
    const fixture = analyzeSsaFixture(`
      function f() {
        let x = 0;
        while (cond(x)) {
          x = next(x);
        }
        return x;
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    assertPhiPlacementEqualsFrontier(fixture, fixture.identifier("x"));
  });

  it("nested loops: φ at each header", () => {
    const fixture = analyzeSsaFixture(`
      function f() {
        let x = 0;
        while (outer(x)) {
          while (inner(x)) {
            x = step(x);
          }
        }
        return x;
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    assertPhiPlacementEqualsFrontier(fixture, fixture.identifier("x"));
  });

  it("reassignment across branches then read", () => {
    const fixture = analyzeSsaFixture(`
      function f(p, q) {
        let x = init();
        if (p) {
          x = a();
        }
        if (q) {
          x = b();
        }
        return use(x);
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    assertPhiPlacementEqualsFrontier(fixture, fixture.identifier("x"));
  });

  it("shadowing: inner and outer bindings are kept distinct", () => {
    const fixture = analyzeSsaFixture(`
      function f(p) {
        let x = 1;
        {
          let x = 2;
          if (p) {
            x = 3;
          }
          inner(x);
        }
        return x;
      }
    `);
    assertPhisWithinDominanceFrontier(fixture);
    // The OUTER x is never reassigned after its single definition, so it
    // gets no φ; the INNER x (written in a branch, read after) does.
    const outerX = fixture.identifier("x");
    expect(fixture.ssa.bindingOf(outerX)).not.toBe(
      fixture.ssa.bindingOf(fixture.identifier("x#2")),
    );
  });
});

describe("ssa / value queries", () => {
  it("versions distinguish writes and the merged read", () => {
    const fixture = analyzeSsaFixture(`
      function f(p) {
        let x = 1;
        if (p) {
          x = 2;
        }
        return x;
      }
    `);
    const firstWrite = fixture.ssa.versionAt(fixture.identifier("x")); // let x = 1
    const branchWrite = fixture.ssa.versionAt(fixture.identifier("x#2")); // x = 2
    const mergedRead = fixture.ssa.reachingDefinition(fixture.identifier("x#3")); // return x
    expect(firstWrite).not.toBeNull();
    expect(branchWrite).not.toBeNull();
    expect(mergedRead).not.toBeNull();
    expect(firstWrite!.version).not.toBe(branchWrite!.version);
    // The returned value is the φ result — neither of the two source writes.
    expect(mergedRead!.version).not.toBe(firstWrite!.version);
    expect(mergedRead!.version).not.toBe(branchWrite!.version);
  });

  it("isRedefinedBetween tracks a write on the path", () => {
    const fixture = analyzeSsaFixture(`
      function f(p) {
        let x = read();
        capture(x);
        if (p) {
          x = mutate();
        }
        return finalUse(x);
      }
    `);
    const binding = fixture.ssa.bindingOf(fixture.identifier("x"));
    expect(binding).not.toBeNull();
    const captureUse = fixture.identifier("x#2"); // capture(x)
    const finalUse = fixture.identifier("x#4"); // finalUse(x)
    const declaration = fixture.identifier("x"); // let x = read()
    expect(fixture.ssa.isRedefinedBetween(captureUse, finalUse, binding!)).toBe(true);
    // No write between the declaration and the capture immediately after it.
    expect(fixture.ssa.isRedefinedBetween(declaration, captureUse, binding!)).toBe(false);
  });
});

describe("ssa / DOT rendering", () => {
  it("renders φ-functions in the block label", () => {
    const fixture = analyzeSsaFixture(`
      function f(p) {
        let x = 1;
        if (p) {
          x = 2;
        }
        return x;
      }
    `);
    const dot = fixture.ssa.controlFlow.toDot(fixture.functions[1]!.owner);
    expect(dot).not.toBeNull();
    expect(dot!).toContain("φ(");
    expect(dot!).toContain("x#");
  });
});
