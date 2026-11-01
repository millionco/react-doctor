import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const ownedObserverSource =
  "import { useEffect } from 'react';\nexport const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {\n  useEffect(() => {\n    if (typeof ResizeObserver !== 'undefined') {\n      const observer = new ResizeObserver(() => {});\n      const interval = setInterval(() => {\n        if (target) {\n          clearInterval(interval);\n          observer.observe(target);\n        }\n      }, 10);\n      return () => {\n        clearInterval(interval);\n        observer.disconnect();\n      };\n    }\n  }, [target]);\n  return <div />;\n};\n";
const ordinaryIntervalSource =
  'import { useEffect } from "react";\nexport const IntervalPanel = ({ consume }: { consume: () => void }) => {\n  useEffect(() => {\n    const interval = setInterval(() => { consume(); }, 10);\n    return () => clearInterval(interval);\n  }, [consume]);\n  return <div />;\n};\n';

const cases = [
  { name: "nominal native observer cleanup", code: ownedObserverSource, expectedCount: 0 },
  {
    name: "erased-ResizeObserver-interface",
    code: ownedObserverSource.replace(
      "export const ObserverPanel",
      "interface ResizeObserver {}\nexport const ObserverPanel",
    ),
    expectedCount: 0,
  },
  {
    name: "erased-ResizeObserver-type",
    code: ownedObserverSource.replace(
      "export const ObserverPanel",
      "type ResizeObserver = {};\nexport const ObserverPanel",
    ),
    expectedCount: 0,
  },
  {
    name: "erased-clearInterval-interface",
    code: ownedObserverSource.replace(
      "export const ObserverPanel",
      "interface clearInterval {}\nexport const ObserverPanel",
    ),
    expectedCount: 0,
  },
  { name: "ordinary native interval cleanup", code: ordinaryIntervalSource, expectedCount: 0 },
  {
    name: "ordinary erased clearInterval cleanup",
    code: ordinaryIntervalSource.replace(
      "export const",
      "interface clearInterval {}\nexport const",
    ),
    expectedCount: 0,
  },
  {
    name: "ordinary overwritten global clearInterval retains warning",
    code: ordinaryIntervalSource.replace(
      "export const",
      "const replacementClear = () => {}; clearInterval = replacementClear;\nexport const",
    ),
    expectedCount: 1,
  },
  {
    name: "ordinary overwritten erased clearInterval retains warning",
    code: ordinaryIntervalSource.replace(
      "export const",
      "interface clearInterval {}\nconst replacementClear = () => {}; clearInterval = replacementClear;\nexport const",
    ),
    expectedCount: 1,
  },
  {
    name: "erased React hook retains missing-disconnect warning",
    code: ownedObserverSource
      .replace("export const ObserverPanel", "interface useEffect {}\nexport const ObserverPanel")
      .replace("        observer.disconnect();\n", ""),
    expectedCount: 1,
  },
  {
    name: "erased-native-constructor-with-prototype-write",
    code: ownedObserverSource.replace(
      "export const ObserverPanel",
      "interface ResizeObserver {}\nResizeObserver.prototype.disconnect = () => {};\nexport const ObserverPanel",
    ),
    expectedCount: 1,
    expectedResourceName: "observe",
  },
  {
    name: "erased-native-clear-interval-with-write",
    code: ownedObserverSource.replace(
      "export const ObserverPanel",
      "interface clearInterval {}\nconst replacementClear = () => {}; clearInterval = replacementClear;\nexport const ObserverPanel",
    ),
    expectedCount: 1,
    expectedResourceName: "setInterval",
  },
  {
    name: "genuine runtime clearInterval shadow retains warning",
    code: ordinaryIntervalSource.replace(
      "({ consume }: { consume: () => void })",
      "({ consume, clearInterval }: { consume: () => void; clearInterval: (handle: unknown) => void })",
    ),
    expectedCount: 1,
  },
];

describe("native interval observer runtime binding review", () => {
  for (const control of cases) {
    it(control.name, () => {
      const result = runRule(effectNeedsCleanup, control.code, {
        filename: "/synthetic/interval-observer/runtime-binding-review.tsx",
        settings: { "react-doctor": { capabilities: ["react"] } },
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(control.expectedCount);
      if ("expectedResourceName" in control && control.expectedResourceName) {
        expect(result.diagnostics[0]?.message).toContain(`\`${control.expectedResourceName}\``);
      }
    });
  }
});
