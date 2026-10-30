import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface ErasedAllocatorStatementCase {
  name: string;
  code: string;
  expectedWarning: boolean;
}

const baseCode = `import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => {
        document.removeEventListener("click", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
`;

const cases: ReadonlyArray<ErasedAllocatorStatementCase> = [
  {
    name: "allocator interface is erased",
    code: baseCode.replace(
      "      document.addEventListener",
      "      interface AllocatorMarker {}\n      document.addEventListener",
    ),
    expectedWarning: false,
  },
  {
    name: "allocator type alias is erased",
    code: baseCode.replace(
      "      document.addEventListener",
      "      type AllocatorLabel = string;\n      document.addEventListener",
    ),
    expectedWarning: false,
  },
  {
    name: "cleanup interface is erased",
    code: baseCode.replace(
      "        document.removeEventListener",
      "        interface CleanupMarker {}\n        document.removeEventListener",
    ),
    expectedWarning: false,
  },
  {
    name: "cleanup type alias is erased",
    code: baseCode.replace(
      "        document.removeEventListener",
      "        type CleanupLabel = string;\n        document.removeEventListener",
    ),
    expectedWarning: false,
  },
  {
    name: "erased cleanup declaration preserves actual handler binding",
    code: baseCode.replace(
      "        document.removeEventListener",
      "        interface handler {}\n        document.removeEventListener",
    ),
    expectedWarning: false,
  },
  {
    name: "erased cleanup declaration does not hide a wrong capture",
    code: baseCode
      .replace(
        "        document.removeEventListener",
        "        interface CleanupMarker {}\n        document.removeEventListener",
      )
      .replace(
        'removeEventListener("click", handler, false)',
        'removeEventListener("click", handler, true)',
      ),
    expectedWarning: true,
  },
  {
    name: "runtime allocator enum remains outside the certificate",
    code: baseCode.replace(
      "      document.addEventListener",
      "      enum AllocatorMarker { Value }\n      document.addEventListener",
    ),
    expectedWarning: true,
  },
  {
    name: "runtime cleanup class remains outside the certificate",
    code: baseCode.replace(
      "        document.removeEventListener",
      "        class CleanupMarker {}\n        document.removeEventListener",
    ),
    expectedWarning: true,
  },
  {
    name: "erased declarations still require an actual removal",
    code: baseCode.replace(
      '        document.removeEventListener("click", handler, false);',
      "        interface CleanupMarker {}",
    ),
    expectedWarning: true,
  },
];

describe("effect-needs-cleanup erased local allocator statements", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(effectNeedsCleanup, testCase.code, {
        filename: "/synthetic/erased-allocator-statements.tsx",
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(
        testCase.expectedWarning
          ? [
              {
                line: 3,
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
