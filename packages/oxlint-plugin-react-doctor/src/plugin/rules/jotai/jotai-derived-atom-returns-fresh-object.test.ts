import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jotaiDerivedAtomReturnsFreshObject } from "./jotai-derived-atom-returns-fresh-object.js";

describe("jotai-derived-atom-returns-fresh-object", () => {
  it("flags atom returning fresh object literal (concise arrow body)", () => {
    const code = `
      import { atom } from "jotai";
      const summaryAtom = atom((get) => ({
        count: get(cartAtom).items.length,
        total: sum(get(cartAtom).items),
      }));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Object.is");
  });

  it("flags atom returning array-producing chain (.filter().map())", () => {
    const code = `
      import { atom } from "jotai";
      const activeIdsAtom = atom((get) =>
        get(usersAtom).filter((user) => user.active).map((user) => user.id)
      );
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom returning .slice() chain", () => {
    const code = `
      import { atom } from "jotai";
      const topThreeAtom = atom((get) => get(usersAtom).slice(0, 3));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom returning .toSorted() chain (ES2023 immutable)", () => {
    const code = `
      import { atom } from "jotai";
      const sortedAtom = atom((get) => get(usersAtom).toSorted((a, b) => a.id - b.id));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom returning Object.entries(get(x))", () => {
    const code = `
      import { atom } from "jotai";
      const entriesAtom = atom((get) => Object.entries(get(mapAtom)));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom returning Array.from(get(x))", () => {
    const code = `
      import { atom } from "jotai";
      const arrayAtom = atom((get) => Array.from(get(setAtom)));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom returning fresh ArrayExpression literal", () => {
    const code = `
      import { atom } from "jotai";
      const pairAtom = atom((get) => [get(aAtom), get(bAtom)]);
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom whose block body returns a fresh object", () => {
    const code = `
      import { atom } from "jotai";
      const summaryAtom = atom((get) => {
        const cart = get(cartAtom);
        return { count: cart.items.length, total: sum(cart.items) };
      });
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom with renamed get parameter (g instead of get)", () => {
    const code = `
      import { atom } from "jotai";
      const summaryAtom = atom((g) => ({ count: g(cartAtom).items.length }));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags atom that spreads an upstream get", () => {
    const code = `
      import { atom } from "jotai";
      const wrappedAtom = atom((get) => ({ ...get(baseAtom) }));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag atom returning a primitive property", () => {
    const code = `
      import { atom } from "jotai";
      const countAtom = atom((get) => get(cartAtom).items.length);
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag atom returning a get(...) member chain (reference-stable)", () => {
    const code = `
      import { atom } from "jotai";
      const userAtom = atom((get) => get(rawAtom).user);
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag primitive atom (no function arg)", () => {
    const code = `
      import { atom } from "jotai";
      const countAtom = atom(0);
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag write-only atom (g, s) => ...", () => {
    const code = `
      import { atom } from "jotai";
      const writeOnlyAtom = atom(
        (get) => get(baseAtom),
        (get, set, newValue) => set(baseAtom, { ...get(baseAtom), ...newValue })
      );
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a constant object literal (no get(...) inside)", () => {
    const code = `
      import { atom } from "jotai";
      const constantAtom = atom(() => ({ defaults: true }));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag homegrown `atom` from a non-jotai source", () => {
    const code = `
      import { atom } from "./my-atoms";
      const summaryAtom = atom((get) => ({ count: get(c).items.length }));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag .filter().reduce() — outer .reduce returns a primitive", () => {
    // Regression: an earlier draft walked inward past non-matching
    // methods and would flag any chain that included a fresh-producer
    // step anywhere. The outer terminator (reduce/find/some/every/
    // includes/at/join) consumes the array and returns a scalar that
    // dedupes via Object.is. Only the OUTERMOST step decides freshness.
    const code = `
      import { atom } from "jotai";
      const totalAtom = atom((get) =>
        get(usersAtom).filter((u) => u.active).reduce((sum, u) => sum + u.score, 0)
      );
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag .find() / .some() / .includes() chains over a get-array", () => {
    const code = `
      import { atom } from "jotai";
      const firstActiveAtom = atom((get) => get(usersAtom).filter((u) => u.active).find((u) => u.id === "primary"));
      const anyActiveAtom = atom((get) => get(usersAtom).some((u) => u.active));
      const hasPrimaryAtom = atom((get) => get(usersAtom).map((u) => u.id).includes("primary"));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag .join() — returns a string", () => {
    const code = `
      import { atom } from "jotai";
      const csvAtom = atom((get) => get(usersAtom).map((u) => u.id).join(","));
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags atom whose block body has multiple returns ALL producing fresh literals", () => {
    const code = `
      import { atom } from "jotai";
      const conditionalAtom = atom((get) => {
        if (get(switchAtom)) return { a: get(aAtom) };
        return { b: get(bAtom) };
      });
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag atom whose block body has a mix of fresh + stable returns", () => {
    // One branch returns a fresh literal, the other returns a reference-
    // stable upstream value — the cost only hits one path, recommendation
    // doesn't generalize. Stay quiet.
    const code = `
      import { atom } from "jotai";
      const conditionalAtom = atom((get) => {
        if (get(switchAtom)) return get(passthroughAtom);
        return { fresh: get(other) };
      });
    `;
    const result = runRule(jotaiDerivedAtomReturnsFreshObject, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
