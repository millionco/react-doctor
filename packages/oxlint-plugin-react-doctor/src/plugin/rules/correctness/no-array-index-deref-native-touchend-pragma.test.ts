import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const cases = [
  {
    name: "baseline",
    code: "export const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n",
    expected: 0,
  },
  {
    name: "inert-jsx-pragma-string",
    code: 'const label="@jsx customElement";void label;\nexport const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n',
    expected: 0,
  },
  {
    name: "actual-jsx-pragma-comment",
    code: "/** @jsx customElement */\nexport const Screen = () => <div onTouchEnd={event => console.log(event.changedTouches[0].clientX)} />;\n",
    expected: 1,
  },
];

const options: RunRuleOptions = {
  filename: "src/native-touchend/pragma-source.tsx",
  includeLocations: true,
  forceJsx: false,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      framework: "nextjs",
      capabilities: [
        "nextjs",
        "nextjs:15",
        "nextjs:16",
        "react",
        "react:17",
        "react:18",
        "react:19",
      ],
    },
  },
};

describe("native touchend JSX pragma source classification", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, testCase.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
