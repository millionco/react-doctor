import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const buildSource = (
  guard = "if (changed) { setPrevious(category); setRows([]); }",
  selection = "const visibleRows = changed ? [] : rows;",
  reader = "useEffect(() => { publish(visibleRows); }, [publish, visibleRows]);",
) => `
  import { useEffect, useMemo, useState } from "react";

  export function Results({ category, fallback, enabled, publish }) {
    const [previous, setPrevious] = useState(category);
    const [rows, setRows] = useState([]);
    const changed = category !== previous;
    ${guard}
    ${selection}
    ${reader}
    return null;
  }
`;

const messagesOf = (source: string) => {
  const result = runRule(exhaustiveDeps, source, { filename: "results.tsx" });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.message);
};

describe("exhaustive-deps — conditional array during a render retry", () => {
  it("accepts an effect dependency whose fresh branch always retries render", () => {
    expect(messagesOf(buildSource())).toEqual([]);
  });

  it.each([
    ["a conditional update", "if (changed) { if (enabled) setPrevious(category); }"],
    ["a different guard", "if (enabled) { setPrevious(category); }"],
    ["a deferred update", "if (changed) { setTimeout(() => setPrevious(category), 0); }"],
    ["a different update value", "if (changed) { setPrevious(fallback); }"],
    ["a setter escape", "if (changed) { setPrevious(category); } publish(setPrevious);"],
    ["no update", ""],
  ])("still reports freshness with %s", (_name, guard) => {
    expect(messagesOf(buildSource(guard))).toEqual([
      expect.stringContaining("`visibleRows` is rebuilt every render"),
    ]);
  });

  it("still reports an allocation in the branch used by the effect", () => {
    expect(
      messagesOf(buildSource(undefined, "const visibleRows = changed ? [] : rows.slice();")),
    ).toEqual([expect.stringContaining("`visibleRows` is rebuilt every render")]);
  });

  it("still reports freshness for a memo calculation that can run during the retry", () => {
    expect(
      messagesOf(
        buildSource(undefined, undefined, "useMemo(() => visibleRows.length, [visibleRows]);"),
      ),
    ).toEqual([expect.stringContaining("`useMemo` runs every time")]);
  });

  it("still reports an omitted capture in the same effect", () => {
    expect(
      messagesOf(
        buildSource(
          undefined,
          undefined,
          "useEffect(() => { publish(visibleRows, fallback); }, [publish, visibleRows]);",
        ),
      ),
    ).toEqual([expect.stringContaining("stale `fallback`")]);
  });
});
