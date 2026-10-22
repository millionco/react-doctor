import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("native media capability control for prop adjustments", () => {
  it.each([
    {
      name: "native media constant writer",
      source:
        'import { useEffect, useState } from "react";\nconst MediaReadyPanel = ({ token }) => {\n  const [ready, setReady] = useState(false);\n  useEffect(() => { if (document.createElement("video").canPlayType("video/example")) setReady(true); }, [token]);\n  return ready;\n};\n',
      expected: 0,
    },
    {
      name: "pure prop constant writer",
      source:
        'import { useEffect, useState } from "react";\nconst MediaReadyPanel = ({ token }) => {\n  const [ready, setReady] = useState(false);\n  useEffect(() => { if (token) setReady(true); }, [token]);\n  return ready;\n};\n',
      expected: 1,
    },
  ])("$name", ({ source, expected }) => {
    const result = runRule(noAdjustStateOnPropChange, source, {
      filename: "synthetic-media-panel.tsx",
      includeLocations: true,
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
