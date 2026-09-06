import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup — deferred iterator traversal parity", () => {
  it.each([
    {
      name: "deferred-foreach-timer",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const rotate = () => { items.forEach(() => { setTimeout(() => update(), 100); }); }; const interval = setInterval(rotate, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-map-collected-timers",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const handles = []; const interval = setInterval(() => { items.map(() => { handles.push(setTimeout(() => update(), 100)); }); }, 1000); return () => { clearInterval(interval); handles.forEach(clearTimeout); }; }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-nested-iterators",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.forEach(() => { items.map(() => { setTimeout(() => update(), 100); }); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-reduce-timer",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.reduce(() => { setTimeout(() => update(), 100); }, null); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-array-from-timer",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { Array.from(items, () => { setTimeout(() => update(), 100); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-find-timer",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.find(() => { setTimeout(() => update(), 100); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 0,
    },
    {
      name: "deferred-computed-foreach-timer",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items['forEach'](() => { setTimeout(() => update(), 100); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 0,
    },
    {
      name: "deferred-iterator-named-callback",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const allocate = () => { setTimeout(() => update(), 100); }; const interval = setInterval(() => { items.forEach(allocate); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 0,
    },
    {
      name: "deferred-iterator-local-helper",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.forEach(() => { const allocate = () => { setTimeout(() => update(), 100); }; allocate(); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 0,
    },
    {
      name: "deferred-iterator-second-argument",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.forEach(() => {}, () => { setTimeout(() => update(), 100); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 0,
    },
    {
      name: "deferred-iterator-returned-cleanup",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.forEach(() => { const timeout = setTimeout(() => update(), 100); return () => clearTimeout(timeout); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-iterator-synchronously-released",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.forEach(() => { const timeout = setTimeout(() => update(), 100); clearTimeout(timeout); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
    {
      name: "deferred-iterator-cancelled-timer-callback",
      source:
        "import { useEffect } from 'react'; export const Preview = ({ items }) => { useEffect(() => { const interval = setInterval(() => { items.forEach(() => { const timeout = setTimeout(() => { setInterval(() => update(), 100); }, 100); clearTimeout(timeout); }); }, 1000); return () => clearInterval(interval); }, [items]); return null; };",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(effectNeedsCleanup, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(
      expectedCount === 0
        ? []
        : [
            {
              column: source.indexOf("useEffect("),
              line: 1,
              message:
                "`setTimeout` creates a timer in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
              nodeType: "CallExpression",
            },
          ],
    );
  });
});
