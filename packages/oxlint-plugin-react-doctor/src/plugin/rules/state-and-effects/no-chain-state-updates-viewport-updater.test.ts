import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

const stockViewport = `import { useEffect, useMemo, useState } from 'react';

export function Panel({ breakpoint, active, target }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [open, setOpen] = useState(true);
  const wide = useMemo(() => viewport.width > breakpoint, [viewport, breakpoint]);

  const schedule = () => {
    const handle = window.setTimeout(() => { target.focus(); }, 1);
    window.clearTimeout(handle);
  };

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport((old) => old.width === width && old.height === height ? old : { width, height });
  };

  useEffect(() => {
    window.addEventListener('resize', onResize);
    const width = window.innerWidth;
    const height = window.innerHeight;
    setViewport({ width, height });
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [wide]);

  return <button onClick={schedule}>{String(open)}</button>;
}`;

const addScheduleStatement = (statement: string): string =>
  stockViewport.replace(
    "  const schedule = () => {",
    `  const schedule = () => {\n    ${statement}`,
  );

const cases = [
  {
    name: "allows exact equality reuse with private state and callable window timers",
    source: stockViewport,
    reported: false,
  },
  {
    name: "reports when an application event mutates a previous viewport axis",
    source: addScheduleStatement("viewport.width += 100;"),
    reported: true,
  },
  {
    name: "reports when application code receives the entire viewport record",
    source: addScheduleStatement("target.consume(viewport);"),
    reported: true,
  },
  {
    name: "reports when the updater checks the wrong previous axis",
    source: stockViewport.replace("old.height === height", "old.width === height"),
    reported: true,
  },
  {
    name: "reports when the updater compares the wrong captured measurement",
    source: stockViewport.replace("old.height === height", "old.height === width"),
    reported: true,
  },
  {
    name: "reports when a window timer accepts executable code",
    source: stockViewport.replace(
      "window.setTimeout(() => { target.focus(); }, 1)",
      'window.setTimeout("window.addEventListener = function (_, listener) { listener(); }", 1)',
    ),
    reported: true,
  },
  {
    name: "reports when the native resize handler also changes unrelated state",
    source: stockViewport
      .replace(
        "  const [open, setOpen] = useState(true);",
        "  const [open, setOpen] = useState(true);\n  const [other, setOther] = useState(0);",
      )
      .replace(
        "    const width = window.innerWidth;",
        "    setOther((count) => count + 1);\n    const width = window.innerWidth;",
      )
      .replace("{String(open)}</button>", "{String(open)}{other}</button>"),
    reported: true,
  },
  {
    name: "reports when an application handler can also replace viewport state",
    source: addScheduleStatement("setViewport({ width: 800, height: 600 });"),
    reported: true,
  },
];

for (const portedRuleMode of ["curated", "upstream"] as const) {
  describe(`no-chain-state-updates functional viewport updater (${portedRuleMode})`, () => {
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
