import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types/index.js";
import { suppressMemoizationInBailedOutFunctions } from "../src/runners/oxlint/suppress-memoization-in-bailed-out-functions.js";

const TWO_COMPONENT_FIXTURE = `import { useMemo, useCallback } from "react";
import { useSharedValue } from "react-native-reanimated";

export const BailedOut = ({ items }) => {
  const shared = useSharedValue(0);
  const handlePress = useCallback(() => {
    shared.value = 1;
  }, [shared]);
  const sorted = useMemo(() => [...items].sort(), [items]);
  return <button onClick={handlePress}>{sorted.length}</button>;
};

export const Optimized = ({ items }) => {
  const doubled = useMemo(() => items.map((item) => item * 2), [items]);
  return <span>{doubled.length}</span>;
};
`;

const MODULE_SCOPE_MEMO_FIXTURE = `import { memo } from "react";

export const Wrapped = memo(
  ({ value }) => {
    window.title = value;
    return <span>{value}</span>;
  },
);
`;

const buildDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "fixture.tsx",
  plugin: "react-doctor",
  rule: "react-compiler-no-manual-memoization",
  severity: "warning",
  message: "This `useMemo` is dead weight.",
  help: "",
  url: "",
  line: 1,
  column: 1,
  category: "Performance",
  ...overrides,
});

describe("suppressMemoizationInBailedOutFunctions", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "memo-bailout-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFixture = (name: string, contents: string): void => {
    fs.writeFileSync(path.join(temporaryDirectory, name), contents);
  };

  it("drops the redundant-memo finding when the same component has a compiler bail-out", () => {
    writeFixture("fixture.tsx", TWO_COMPONENT_FIXTURE);
    const memoDiagnostic = buildDiagnostic({ line: 9 });
    const bailoutDiagnostic = buildDiagnostic({
      plugin: "react-hooks-js",
      rule: "preserve-manual-memoization",
      message: "Compilation skipped: memoization could not be preserved.",
      line: 6,
    });

    const survivors = suppressMemoizationInBailedOutFunctions(
      [memoDiagnostic, bailoutDiagnostic],
      temporaryDirectory,
    );

    expect(survivors).toEqual([bailoutDiagnostic]);
  });

  it("keeps the redundant-memo finding in a sibling component the compiler did optimize", () => {
    writeFixture("fixture.tsx", TWO_COMPONENT_FIXTURE);
    const optimizedComponentMemoDiagnostic = buildDiagnostic({ line: 14 });
    const bailoutDiagnostic = buildDiagnostic({
      plugin: "react-hooks-js",
      rule: "refs",
      message: "Ref values may not be read during render.",
      line: 6,
    });

    const survivors = suppressMemoizationInBailedOutFunctions(
      [optimizedComponentMemoDiagnostic, bailoutDiagnostic],
      temporaryDirectory,
    );

    expect(survivors).toEqual([optimizedComponentMemoDiagnostic, bailoutDiagnostic]);
  });

  it("keeps the finding when the bail-out is in a different file", () => {
    writeFixture("fixture.tsx", TWO_COMPONENT_FIXTURE);
    const memoDiagnostic = buildDiagnostic({ line: 9 });
    const otherFileBailout = buildDiagnostic({
      filePath: "other.tsx",
      plugin: "react-hooks-js",
      rule: "todo",
      line: 6,
    });

    const survivors = suppressMemoizationInBailedOutFunctions(
      [memoDiagnostic, otherFileBailout],
      temporaryDirectory,
    );

    expect(survivors).toEqual([memoDiagnostic, otherFileBailout]);
  });

  it("drops a module-scope memo() wrapper whose inline component bailed out, via the call span", () => {
    writeFixture("fixture.tsx", MODULE_SCOPE_MEMO_FIXTURE);
    const memoCallStartIndex = MODULE_SCOPE_MEMO_FIXTURE.indexOf("memo(");
    const memoCallEndIndex = MODULE_SCOPE_MEMO_FIXTURE.indexOf(");") + 1;
    const memoDiagnostic = buildDiagnostic({
      message: "This `memo()` is dead weight.",
      line: 3,
      offset: Buffer.byteLength(MODULE_SCOPE_MEMO_FIXTURE.slice(0, memoCallStartIndex)),
      length: Buffer.byteLength(
        MODULE_SCOPE_MEMO_FIXTURE.slice(memoCallStartIndex, memoCallEndIndex),
      ),
    });
    const purityBailout = buildDiagnostic({
      plugin: "react-hooks-js",
      rule: "purity",
      message: "Writing to a global during render is a side effect.",
      line: 5,
    });

    const survivors = suppressMemoizationInBailedOutFunctions(
      [memoDiagnostic, purityBailout],
      temporaryDirectory,
    );

    expect(survivors).toEqual([purityBailout]);
  });

  it("fails open when the source file cannot be read", () => {
    const memoDiagnostic = buildDiagnostic({ filePath: "missing.tsx", line: 9 });
    const bailoutDiagnostic = buildDiagnostic({
      filePath: "missing.tsx",
      plugin: "react-hooks-js",
      rule: "todo",
      line: 6,
    });

    const survivors = suppressMemoizationInBailedOutFunctions(
      [memoDiagnostic, bailoutDiagnostic],
      temporaryDirectory,
    );

    expect(survivors).toEqual([memoDiagnostic, bailoutDiagnostic]);
  });

  it("returns the input untouched when no redundant-memo diagnostics are present", () => {
    const bailoutDiagnostic = buildDiagnostic({
      plugin: "react-hooks-js",
      rule: "todo",
      line: 6,
    });

    const survivors = suppressMemoizationInBailedOutFunctions(
      [bailoutDiagnostic],
      temporaryDirectory,
    );

    expect(survivors).toEqual([bailoutDiagnostic]);
  });
});
