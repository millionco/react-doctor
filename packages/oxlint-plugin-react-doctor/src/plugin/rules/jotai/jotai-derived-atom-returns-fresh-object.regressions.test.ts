import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jotaiDerivedAtomReturnsFreshObject } from "./jotai-derived-atom-returns-fresh-object.js";

describe("jotai/jotai-derived-atom-returns-fresh-object — regressions", () => {
  it("stays silent on `.sort()` applied directly to a get(...) result (same ref)", () => {
    const { diagnostics } = runRule(
      jotaiDerivedAtomReturnsFreshObject,
      `import { atom } from "jotai"; const sortedAtom = atom((get) => get(itemsAtom).sort());`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on `.reverse()` applied directly to a get(...) result", () => {
    const { diagnostics } = runRule(
      jotaiDerivedAtomReturnsFreshObject,
      `import { atom } from "jotai"; const revAtom = atom((get) => get(itemsAtom).reverse());`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags `.slice().sort()` — receiver is a fresh chain", () => {
    const { diagnostics } = runRule(
      jotaiDerivedAtomReturnsFreshObject,
      `import { atom } from "jotai"; const a = atom((get) => get(itemsAtom).slice().sort());`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a fresh object literal", () => {
    const { diagnostics } = runRule(
      jotaiDerivedAtomReturnsFreshObject,
      `import { atom } from "jotai"; const a = atom((get) => ({ x: get(xAtom) }));`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
