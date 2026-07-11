import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectListenerCleanupMismatch } from "./effect-listener-cleanup-mismatch.js";

interface ListenerControlFlowTestCase {
  code: string;
  expectedCount: number;
  name: string;
}

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(
    effectListenerCleanupMismatch,
    `import { useEffect } from "react";\n${code}`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("effect-listener-cleanup-mismatch canonical cleanup shape", () => {
  const testCases: ListenerControlFlowTestCase[] = [
    {
      name: "cleanup returned before a later registration",
      code: `useEffect(() => {
        const firstListener = () => firstResize();
        window.addEventListener("resize", firstListener);
        return () => window.removeEventListener("resize", () => firstResize());
        window.addEventListener("scroll", () => scroll());
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "cleanup returned from a nested conditional",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        if (shouldCleanup) {
          return () => window.removeEventListener("resize", () => resize());
        }
        continueSetup();
      }, [shouldCleanup]);`,
      expectedCount: 0,
    },
    {
      name: "mutually exclusive setup registrations",
      code: `useEffect(() => {
        const handleResize = () => resize();
        if (shouldListen) {
          window.addEventListener("resize", handleResize);
        }
        return () => window.removeEventListener("resize", () => resize());
      }, [shouldListen]);`,
      expectedCount: 0,
    },
    {
      name: "a final cleanup-body return expression",
      code: `useEffect(() => {
        document.addEventListener("mousedown", (event) => { return handle(event); });
        return () => {
          return (document.removeEventListener(
            "mousedown",
            (event) => { return handle(event); },
          ));
        };
      }, []);`,
      expectedCount: 1,
    },
  ];

  for (const testCase of testCases) {
    it(`handles ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }
});

describe("effect-listener-cleanup-mismatch computed methods", () => {
  const testCases: ListenerControlFlowTestCase[] = [
    {
      name: "computed string removal mismatch",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => window["removeEventListener"]("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "computed string valid removal",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => window["removeEventListener"]("resize", handleResize);
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "computed string abort with an aliased signal",
      code: `useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;
        window.addEventListener("resize", () => resize(), { signal });
        return () => {
          window.removeEventListener("resize", () => resize());
          controller["abort"]();
        };
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "const-computed removal mismatch",
      code: `useEffect(() => {
        const handleResize = () => resize();
        const removalMethod = "removeEventListener";
        window.addEventListener("resize", handleResize);
        return () => window[removalMethod]("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
  ];

  for (const testCase of testCases) {
    it(`handles ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }
});
