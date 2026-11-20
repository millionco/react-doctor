import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const retainedReading = `import { useEffect, useRef, useState } from 'react';
export const useRetainedReading = (active, latestValue) => {
  const [reading, setReading] = useState(Number(latestValue) || 0);
  const lastMode = useRef(active);
  useEffect(() => {
    const previousMode = lastMode.current;
    const nextReading = Number(latestValue) || 0;
    if (active !== previousMode) {
      setReading(nextReading);
    } else if (!active) {
      setReading(nextReading);
    }
    lastMode.current = active;
  }, [active, latestValue]);
  return reading;
};`;

const warningLines = (source: string) => {
  const result = runRule(noDerivedState, source, { includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map((diagnostic) => diagnostic.line);
};

describe("no-derived-state — values held across committed mode changes", () => {
  it("keeps the separate idle copy warning and permits the transition sample", () => {
    expect(warningLines(retainedReading)).toEqual([11]);
  });

  it("supports a separate numeric update of the held reading", () => {
    const source = retainedReading.replace(
      "return reading;",
      "defer(() => setReading(previousReading => previousReading + 1)); return reading;",
    );
    expect(warningLines(source)).toEqual([11]);
  });

  it("reports both copies when both transition outcomes synchronize the value", () => {
    const source = retainedReading.replace("} else if (!active) {", "} else {");
    expect(warningLines(source)).toEqual([9, 11]);
  });

  it("reports both copies when the tracker stays inactive during capture", () => {
    const source = retainedReading.replace(
      "lastMode.current = active;",
      "lastMode.current = false;",
    );
    expect(warningLines(source)).toEqual([9, 11]);
  });

  it("reports both copies when an external call can change the tracker", () => {
    const source = retainedReading.replace("return reading;", "inspect(lastMode); return reading;");
    expect(warningLines(source)).toEqual([9, 11]);
  });

  it("reports both copies when an external call could replace the sampled state", () => {
    const source = retainedReading.replace(
      "return reading;",
      "copyReading(setReading, latestValue); return reading;",
    );
    expect(warningLines(source)).toEqual([9, 11]);
  });

  it("reports both copies in a private hook whose only caller supplies an inactive mode", () => {
    const privateHook = retainedReading.replace(
      "export const useRetainedReading",
      "const useRetainedReading",
    );
    const source = `${privateHook}\nexport const useAlwaysCurrent = value => useRetainedReading(NaN, value);`;
    expect(warningLines(source)).toEqual([9, 11]);
  });

  it("preserves reports in an exported hook with a same-file call", () => {
    const source = `${retainedReading}\nexport const useAlwaysCurrent = value => useRetainedReading(NaN, value);`;
    expect(warningLines(source)).toEqual([9, 11]);
  });

  it("reports both copies when the visible Number provider has been replaced", () => {
    expect(warningLines(`${retainedReading}\nglobalThis.Number = () => 0;`)).toEqual([9, 11]);
  });
});
