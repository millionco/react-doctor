import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const source = (guard: string, alternate = "") => `
  import { useEffect, useState } from "react";

  function Recommendation(incoming) {
    const [displayed, setDisplayed] = useState(null);
    useEffect(() => {
      if (${guard}) {
        setDisplayed(incoming);
      }${alternate}
    }, [incoming]);
    return <article>{displayed?.label}</article>;
  }
`;

describe("no-derived-state — selection ordered against retained state", () => {
  it.each([
    "incoming.label && (!displayed || incoming.rank >= displayed.rank)",
    "(!displayed || displayed.rank <= incoming.rank) && incoming.label",
    "!displayed || incoming.rank < displayed.rank",
  ])("recognizes retention when %s", (guard) => {
    const result = runRule(noDerivedState, source(guard));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "!displayed || incoming.rank !== displayed.rank",
    "!displayed || incoming.rank >= incoming.rank",
    "!displayed || incoming.rank >= displayed.score",
    "!displayed || incoming.rank >= displayed.rank || true",
    "!displayed || incoming[rank] >= displayed[rank]",
  ])("keeps the warning for a different guard %s", (guard) => {
    const result = runRule(noDerivedState, source(guard));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the warning for a branch that still copies the input", () => {
    const result = runRule(
      noDerivedState,
      source("!displayed || incoming.rank >= displayed.rank", " else { setDisplayed(incoming); }"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("no-derived-state — ordered retention ownership controls", () => {
  const guard = "incoming.label && (!displayed || incoming.rank >= displayed.rank)";

  it("keeps both warnings for complementary branches that always copy", () => {
    const mirrored = source(
      guard,
      "if (!displayed || incoming.rank < displayed.rank) { setDisplayed(incoming); }",
    );
    expect(runRule(noDerivedState, mirrored).diagnostics).toHaveLength(2);
  });

  it("keeps the warning after rebinding displayed before comparing", () => {
    const rebound = source(guard)
      .replace("const [displayed", "let [displayed")
      .replace("      if (", "      displayed = incoming;\n      if (");
    expect(runRule(noDerivedState, rebound).diagnostics).toHaveLength(1);
  });

  it("keeps the warning when an evaluated operand overwrites the rank", () => {
    const mutated = source(
      "(!displayed || (displayed.rank = incoming.rank, true)) && (!displayed || incoming.rank >= displayed.rank)",
    );
    expect(runRule(noDerivedState, mutated).diagnostics).toHaveLength(1);
  });

  it("keeps the warning when a destructuring assignment overwrites the comparison field", () => {
    const mutated = source(guard).replace(
      "    useEffect(",
      "    if (displayed) ({ rank: displayed.rank } = incoming);\n    useEffect(",
    );
    expect(runRule(noDerivedState, mutated).diagnostics).toHaveLength(1);
  });

  it("recognizes a retained choice with a later native reset inside the accepted branch", () => {
    const timed = source(guard).replace(
      "        setDisplayed(incoming);",
      "        setDisplayed(incoming); window.setTimeout(() => setDisplayed(null), 500);",
    );
    expect(runRule(noDerivedState, timed).diagnostics).toEqual([]);
  });

  it.each([
    "scheduler.setTimeout(() => setDisplayed(null), 500);",
    "window.setTimeout(() => setDisplayed(incoming), 500);",
    "registerCleanup(setDisplayed);",
  ])("keeps the copy warning when a second write could bypass retention", (extra) => {
    const unknown = source(guard).replace(
      "        setDisplayed(incoming);",
      `        setDisplayed(incoming); ${extra}`,
    );
    const result = runRule(noDerivedState, unknown);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
