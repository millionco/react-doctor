import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

const stockViewport = `import { useEffect, useState } from "react";

export function Panel({ breakpoint, active, target }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [open, setOpen] = useState(true);
  const wide = viewport.width > breakpoint;

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
  };

  useEffect(() => {
    window.addEventListener("resize", onResize);
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [wide]);

  return <output>{String(open)}</output>;
}`;

const cases = [
  {
    name: "allows a private initial viewport snapshot and its matched resize listener",
    source: stockViewport,
    reported: false,
  },
  {
    name: "reports when an ordinary React handler can also write the viewport state",
    source: stockViewport.replace(
      "<output>{String(open)}</output>",
      "<button onClick={() => setViewport({ width: 900, height: 600 })}>{String(open)}</button>",
    ),
    reported: true,
  },
  {
    name: "reports a viewport update enrolled on a different receiver",
    source: stockViewport
      .replace("window.addEventListener", "target.addEventListener")
      .replace("window.removeEventListener", "target.removeEventListener"),
    reported: true,
  },
  {
    name: "reports when the resize handler also escapes to a React event",
    source: stockViewport.replace(
      "<output>{String(open)}</output>",
      "<button onClick={onResize}>{String(open)}</button>",
    ),
    reported: true,
  },
  {
    name: "reports when cleanup removes a different event",
    source: stockViewport.replace(
      'removeEventListener("resize", onResize)',
      'removeEventListener("scroll", onResize)',
    ),
    reported: true,
  },
  {
    name: "reports when listener enrollment is conditional",
    source: stockViewport.replace(
      'window.addEventListener("resize", onResize);',
      'if (active) window.addEventListener("resize", onResize);',
    ),
    reported: true,
  },
  {
    name: "reports when a string timer can replace the browser listener provider",
    source: `setTimeout("window.addEventListener = function (_, listener) { listener(); }", 0);
${stockViewport}`,
    reported: true,
  },
  {
    name: "reports when the runtime React namespace escapes",
    source: `import * as RuntimeReact from "react";
${stockViewport.replace("  const [viewport,", "  target.configure(RuntimeReact);\n  const [viewport,")}`,
    reported: true,
  },
];

for (const portedRuleMode of ["curated", "upstream"] as const) {
  describe(`no-chain-state-updates viewport origin (${portedRuleMode})`, () => {
    for (const example of cases) {
      it(example.name, () => {
        const result = runRule(noChainStateUpdates, example.source, {
          filename: "fixture.tsx",
          includeLocations: true,
          settings: { "react-doctor": { portedRuleMode } },
        });

        expect(result.parseErrors).toEqual([]);
        const targetLine =
          example.source.split("\n").findIndex((line) => line.includes("setOpen(false)")) + 1;
        expect(targetLine).toBeGreaterThan(0);
        expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual(
          example.reported ? [targetLine] : [],
        );
      });
    }
  });
}
