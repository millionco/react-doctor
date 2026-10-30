import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface NativeAllocatorCase {
  name: string;
  code: string;
  expectedWarning: boolean;
}

const cases: ReadonlyArray<NativeAllocatorCase> = [
  {
    name: "erased native document remains a closed receiver",
    code: `interface document {}
import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedWarning: false,
  },
  {
    name: "captured erased native document remains a closed receiver",
    code: `interface document {}
import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const nativeTarget = document;
    const handler = () => {};
    const allocate = () => {
      nativeTarget.addEventListener("click", handler, false);
      return () => nativeTarget.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedWarning: false,
  },
  {
    name: "runtime document companion remains outside the native certificate",
    code: `interface document {}
import { useEffect } from "react";
export const Example = ({ document }) => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedWarning: true,
  },
  {
    name: "erased document still requires the same capture value",
    code: `interface document {}
import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, true);
    };
    return allocate();
  }, []);
  return null;
};
`,
    expectedWarning: true,
  },
];

describe("effect-needs-cleanup native local allocator providers", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(effectNeedsCleanup, testCase.code, {
        filename: "/synthetic/native-allocator.tsx",
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(
        testCase.expectedWarning
          ? [
              {
                line: 4,
                column: 2,
                nodeType: "CallExpression",
                message:
                  "`addEventListener` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
              },
            ]
          : [],
      );
    });
  }
});
