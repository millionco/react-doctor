import { describe, expect, it } from "vite-plus/test";
import { verifyOpenClose } from "./run-typestate.js";

// Layer C — the typestate protocol engine, exercised through an open/close
// automaton. Leaks (opened-at-exit) and error transitions (illegal events)
// are the two failure modes.

const kinds = (code: string): string[] =>
  verifyOpenClose(code)
    .map((violation) => `${violation.kind}:${violation.resource}`)
    .sort();

describe("verifyTypestate / open-close protocol", () => {
  it("open then close on the only path is clean", () => {
    expect(
      kinds(`
        function f() {
          open(r);
          close(r);
        }
      `),
    ).toEqual([]);
  });

  it("open with no close leaks", () => {
    expect(
      kinds(`
        function f() {
          open(r);
        }
      `),
    ).toEqual(["leaked-resource:r"]);
  });

  it("open on only one branch leaks", () => {
    expect(
      kinds(`
        function f(c) {
          if (c) {
            open(r);
          }
        }
      `),
    ).toEqual(["leaked-resource:r"]);
  });

  it("open and close on both arms of a branch is clean", () => {
    expect(
      kinds(`
        function f(c) {
          if (c) {
            open(r);
            close(r);
          }
        }
      `),
    ).toEqual([]);
  });

  it("an early return that skips close leaks", () => {
    expect(
      kinds(`
        function f(c) {
          open(r);
          if (c) {
            return;
          }
          close(r);
        }
      `),
    ).toEqual(["leaked-resource:r"]);
  });

  it("try/finally close is clean (finalize edge runs on every path)", () => {
    expect(
      kinds(`
        function f() {
          try {
            open(r);
          } finally {
            close(r);
          }
        }
      `),
    ).toEqual([]);
  });

  it("close before open is an error transition", () => {
    expect(
      kinds(`
        function f() {
          close(r);
        }
      `),
    ).toEqual(["error-transition:r"]);
  });

  it("double open is an error transition", () => {
    const violations = verifyOpenClose(`
      function f() {
        open(r);
        open(r);
        close(r);
      }
    `);
    expect(violations.some((violation) => violation.kind === "error-transition")).toBe(true);
  });

  it("two independent resources are tracked separately", () => {
    expect(
      kinds(`
        function f() {
          open(a);
          close(a);
          open(b);
        }
      `),
    ).toEqual(["leaked-resource:b"]);
  });
});

// Layer D — path feasibility refines the leak check by proving that the only
// open-without-close path can't execute. `withFeasibility` toggles the wiring.
const feasibilityKinds = (code: string): string[] =>
  verifyOpenClose(code, true)
    .map((violation) => `${violation.kind}:${violation.resource}`)
    .sort();

describe("verifyTypestate / path-feasibility refinement", () => {
  const correlated = `
    function f(x) {
      if (x) {
        open(r);
      }
      if (x) {
        close(r);
      }
    }
  `;

  it("flags both the leak and the spurious close-before-open WITHOUT feasibility", () => {
    // Path-insensitively, the second `if (x)` closes a maybe-`initial` `r`
    // (close-before-open) AND a maybe-`opened` `r` is left open at exit.
    expect(kinds(correlated)).toEqual(["error-transition:r", "leaked-resource:r"]);
  });

  it("suppresses BOTH false positives WITH feasibility (correlated guards)", () => {
    // The leak needs `if (x)` true-then-false and the close-before-open needs
    // false-then-true — each requires `x` truthy and falsy at once, so both
    // counterexamples are provably infeasible.
    expect(feasibilityKinds(correlated)).toEqual([]);
  });

  it("never suppresses a genuine leak (open with no close)", () => {
    expect(
      feasibilityKinds(`
        function f() {
          open(r);
        }
      `),
    ).toEqual(["leaked-resource:r"]);
  });

  it("keeps the leak when a feasible leak path exists (independent close guard)", () => {
    expect(
      feasibilityKinds(`
        function f(y) {
          open(r);
          if (y) {
            close(r);
          }
        }
      `),
    ).toEqual(["leaked-resource:r"]);
  });
});
