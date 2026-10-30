import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const cases = [
  {
    name: "baseline-native-changed-touch",
    code: "export const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n",
    expected: 0,
  },
  {
    name: "outer-erased-event-interface",
    code: "interface event {}\nexport const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n",
    expected: 0,
  },
  {
    name: "outer-erased-event-type-alias",
    code: "type event = {};\nexport const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n",
    expected: 0,
  },
  {
    name: "inner-erased-event-interface",
    code: "export const Screen = () => <div onTouchEnd={event => { interface event {} console.log(event.changedTouches[0].clientX); }} />;\n",
    expected: 0,
  },
  {
    name: "unrelated-nested-erased-event-interface",
    code: "const inspect = () => { interface event {} };\nexport const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n",
    expected: 0,
  },
  {
    name: "visible-event-list-write",
    code: "export const Screen = () => <div onTouchEnd={event => { event.changedTouches = []; console.log(event.changedTouches[0].clientX); }} />;\n",
    expected: 1,
  },
  {
    name: "visible-event-list-write-plus-interface",
    code: "export const Screen = () => <div onTouchEnd={event => { interface event {} event.changedTouches = []; console.log(event.changedTouches[0].clientX); }} />;\n",
    expected: 1,
  },
  {
    name: "remaining-touches-positive",
    code: "export const Screen = () => <div onTouchEnd={event => console.log(event.touches[0].clientX)} />;\n",
    expected: 1,
  },
];

describe("native touchend runtime event bindings", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, testCase.code, {
        filename: "/synthetic/native-touchend-review/native.tsx",
        includeLocations: true,
        settings: {
          "react-doctor": {
            framework: "nextjs",
            portedRuleMode: "curated",
            capabilities: ["nextjs", "react", "react:19"],
          },
        },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
