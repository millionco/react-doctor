import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

const scenarios = [
  {
    name: "native baseline",
    code: 'const groups = new Map();const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "opaque runtime escape",
    code: 'const groups = new Map();const expose = () => { mutate(groups); }; expose();const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
  {
    name: "inner interface cannot hide escape",
    code: 'const groups = new Map();const expose = () => { interface groups {} mutate(groups); }; expose();const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
  {
    name: "inner type alias cannot hide escape",
    code: 'const groups = new Map();const expose = () => { type groups = unknown; mutate(groups); }; expose();const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
  },
  {
    name: "inert type declaration",
    code: 'const groups = new Map();const inspect = () => { interface groups {} return 1; }; inspect();const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
  {
    name: "genuine local value shields outer map",
    code: 'const groups = new Map();const expose = () => { const groups = {}; interface groups {} mutate(groups); }; expose();const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
  },
];

describe("runtime map references beside erased declarations", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noNonNullAssertionOnMaybeUndefinedResult, scenario.code, {
        filename: "src/map-reference.tsx",
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
