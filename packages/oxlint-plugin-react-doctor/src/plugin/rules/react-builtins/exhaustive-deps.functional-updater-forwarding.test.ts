import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const COVERED_FORWARDER = `
  import { useEffect, useState } from "react";

  const initialSelection = (listKey: string) => ({ listKey, selected: false });

  export function Selection({ listKey, enabled }: { listKey: string; enabled: boolean }) {
    const [selection, setSelection] = useState(() => initialSelection(listKey));
    const changeSelection = (transform: (value: typeof selection) => typeof selection) =>
      setSelection((previous) => transform(
        previous.listKey === listKey ? previous : initialSelection(listKey)
      ));

    useEffect(() => {
      changeSelection((previous) => enabled && !previous.selected
        ? { ...previous, selected: true }
        : previous);
    }, [enabled, listKey]);

    return <output>{String(selection.selected)}</output>;
  }
`;

const NON_COVERING_CASES = [
  {
    name: "the discriminator is missing",
    source: COVERED_FORWARDER.replace("[enabled, listKey]", "[enabled]"),
  },
  {
    name: "a same-named dependency comes from a different binding",
    source: COVERED_FORWARDER.replace(
      "    useEffect",
      "    { const listKey = enabled; useEffect",
    ).replace("[enabled, listKey]);", "[enabled, listKey]); }"),
  },
  {
    name: "an invocation depends on an omitted input",
    source: COVERED_FORWARDER.replace("[enabled, listKey]", "[listKey]"),
  },
  {
    name: "the helper is passed to an opaque consumer",
    source: COVERED_FORWARDER.replace("    useEffect", "    hold(changeSelection);\n    useEffect"),
  },
  {
    name: "the discriminator can be rewritten through destructuring",
    source: COVERED_FORWARDER.replace(
      "    const [selection",
      "    let key = listKey;\n    const [selection",
    )
      .replace(
        "previous.listKey === listKey ? previous : initialSelection(listKey)",
        "previous.listKey === key ? previous : initialSelection(key)",
      )
      .replace("[enabled, listKey]", "[enabled, key]")
      .replace("<output>", '<output onClick={() => { [key] = ["changed"]; }}>'),
  },
  {
    name: "the setter comes from a local function",
    source: COVERED_FORWARDER.replace(
      'import { useEffect, useState } from "react";',
      'import { useEffect } from "react";\nconst useState = (create: unknown) => [create, send];',
    ),
  },
];

describe("exhaustive-deps functional state updater forwarders", () => {
  it("accepts dependencies that cover the only reactive capture", () => {
    const curated = runRule(exhaustiveDeps, COVERED_FORWARDER);
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toEqual([]);
  });

  it("keeps upstream behavior", () => {
    const upstream = runRule(exhaustiveDeps, COVERED_FORWARDER, {
      settings: { "react-doctor": { portedRuleMode: "upstream" } },
    });
    expect(upstream.diagnostics).toHaveLength(1);
  });

  it.each(NON_COVERING_CASES)("reports the helper when $name", ({ source }) => {
    const observed = runRule(exhaustiveDeps, source);
    expect(observed.parseErrors).toEqual([]);
    expect(observed.diagnostics).toHaveLength(1);
    expect(observed.diagnostics[0]?.message).toContain("changeSelection");
  });
});
