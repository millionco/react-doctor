import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactCompilerNoManualMemoization } from "./react-compiler-no-manual-memoization.js";

const expectDiagnosticCount = (code: string, expectedDiagnosticCount: number): void => {
  const result = runRule(reactCompilerNoManualMemoization, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
};

const expectFlaggedApiNames = (code: string, expectedApiSnippets: ReadonlyArray<string>): void => {
  const result = runRule(reactCompilerNoManualMemoization, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedApiSnippets.length);
  for (let diagnosticIndex = 0; diagnosticIndex < expectedApiSnippets.length; diagnosticIndex++) {
    const matchingDiagnostic = result.diagnostics[diagnosticIndex];
    const expectedSnippet = expectedApiSnippets[diagnosticIndex];
    expect(matchingDiagnostic.message).toContain(expectedSnippet);
  }
};

describe("architecture/react-compiler-no-manual-memoization — fail cases", () => {
  it("flags `useMemo` from named import", () => {
    expectFlaggedApiNames(
      `import { useMemo } from "react";
const Component = () => {
  const cachedValue = useMemo(() => 1, []);
  return <span>{cachedValue}</span>;
};`,
      ["useMemo"],
    );
  });

  it("flags `useCallback` from named import", () => {
    expectFlaggedApiNames(
      `import { useCallback } from "react";
const Component = () => {
  const cachedHandler = useCallback(() => undefined, []);
  return <button onClick={cachedHandler} />;
};`,
      ["useCallback"],
    );
  });

  it("flags `memo` HOC call from named import", () => {
    expectFlaggedApiNames(
      `import { memo } from "react";
const Component = memo(({ value }) => <span>{value}</span>);
export default Component;`,
      ["memo()"],
    );
  });

  it("flags renamed named import (`useMemo as memoize`)", () => {
    expectFlaggedApiNames(
      `import { useMemo as memoize } from "react";
const Component = () => {
  const cachedValue = memoize(() => 1, []);
  return <span>{cachedValue}</span>;
};`,
      ["useMemo"],
    );
  });

  it("flags renamed `useCallback` and `memo` aliases", () => {
    expectFlaggedApiNames(
      `import { useCallback as stableCallback, memo as wrapMemo } from "react";
const Inner = ({ onClick }) => <button onClick={onClick} />;
const Wrapped = wrapMemo(Inner);
const Container = () => {
  const handler = stableCallback(() => undefined, []);
  return <Wrapped onClick={handler} />;
};`,
      ["memo()", "useCallback"],
    );
  });

  it("flags `React.useMemo` via default import", () => {
    expectFlaggedApiNames(
      `import React from "react";
const Component = () => {
  const cachedValue = React.useMemo(() => 1, []);
  return <span>{cachedValue}</span>;
};`,
      ["useMemo"],
    );
  });

  it("flags `React.useCallback` and `React.memo` namespace calls", () => {
    expectFlaggedApiNames(
      `import * as React from "react";
const Inner = React.memo(({ onClick }) => <button onClick={onClick} />);
const Container = () => {
  const handler = React.useCallback(() => undefined, []);
  return <Inner onClick={handler} />;
};`,
      ["memo()", "useCallback"],
    );
  });

  it("flags namespace import aliased to a non-React name", () => {
    expectFlaggedApiNames(
      `import * as ReactStuff from "react";
const Component = () => {
  const cachedValue = ReactStuff.useMemo(() => 1, []);
  return <span>{cachedValue}</span>;
};`,
      ["useMemo"],
    );
  });

  it("flags default-imported React aliased to a non-canonical name", () => {
    expectFlaggedApiNames(
      `import MyReact from "react";
const Component = () => {
  const cachedValue = MyReact.useMemo(() => 1, []);
  return <span>{cachedValue}</span>;
};`,
      ["useMemo"],
    );
  });

  it("flags transpiled `_react.useMemo` even without an import declaration", () => {
    expectFlaggedApiNames(`_react.useMemo(() => 1, []);`, ["useMemo"]);
  });

  it("flags `React.memo(Component, areEqual)` with custom comparator", () => {
    expectFlaggedApiNames(
      `import React from "react";
const Inner = ({ value }) => <span>{value}</span>;
const areEqual = (prev, next) => prev.value === next.value;
const Wrapped = React.memo(Inner, areEqual);
export default Wrapped;`,
      ["memo()"],
    );
  });

  it("emits one diagnostic per manual-memoization call in the file", () => {
    expectDiagnosticCount(
      `import { memo, useCallback, useMemo } from "react";
const Inner = memo(({ value, onClick }) => <button onClick={onClick}>{value}</button>);
const Container = () => {
  const value = useMemo(() => 1, []);
  const handler = useCallback(() => undefined, []);
  return <Inner value={value} onClick={handler} />;
};`,
      3,
    );
  });

  it("flags the outer `memo(forwardRef(...))` even when nested", () => {
    expectFlaggedApiNames(
      `import { memo, forwardRef } from "react";
const Wrapped = memo(forwardRef(({ value }, ref) => <span ref={ref}>{value}</span>));
export default Wrapped;`,
      ["memo()"],
    );
  });

  it("flags module-scope `memo(Component)` calls (not just inside components)", () => {
    expectFlaggedApiNames(
      `import { memo } from "react";
const Inner = ({ value }) => <span>{value}</span>;
export const Wrapped = memo(Inner);`,
      ["memo()"],
    );
  });

  it("flags `useMemo` inside a conditional expression branch", () => {
    expectFlaggedApiNames(
      `import { useMemo } from "react";
const Component = ({ shouldCache, value }) => {
  const resolved = shouldCache ? useMemo(() => value * 2, [value]) : value;
  return <span>{resolved}</span>;
};`,
      ["useMemo"],
    );
  });
});

describe("architecture/react-compiler-no-manual-memoization — pass cases (no diagnostics)", () => {
  it("does not flag a locally-declared `useMemo` lookalike", () => {
    expectDiagnosticCount(
      `const useMemo = (compute) => compute();
const Component = () => {
  const cachedValue = useMemo(() => 1);
  return <span>{cachedValue}</span>;
};`,
      0,
    );
  });

  it("does not flag `useMemo` imported from a sibling module", () => {
    expectDiagnosticCount(
      `import { useMemo } from "./local-memo";
const Component = () => {
  const cachedValue = useMemo(() => 1);
  return <span>{cachedValue}</span>;
};`,
      0,
    );
  });

  it("does not flag hook-named symbols imported from a different package", () => {
    expectDiagnosticCount(
      `import { useMemo, useCallback, memo } from "preact/hooks";
const Component = () => {
  const cachedValue = useMemo(() => 1);
  const handler = useCallback(() => undefined);
  return memo(<span onClick={handler}>{cachedValue}</span>);
};`,
      0,
    );
  });

  it("does not flag `lodash.memoize` and other look-alike method calls", () => {
    expectDiagnosticCount(
      `import lodash from "lodash";
const memoized = lodash.memoize(() => 1);
const result = memoized();
export { result };`,
      0,
    );
  });

  it("does not flag `someObject.useMemo()` when `someObject` is not from react", () => {
    expectDiagnosticCount(
      `import { Dispatcher } from "some-internal-renderer";
const cached = Dispatcher.useMemo(() => 1, []);
export { cached };`,
      0,
    );
  });

  it("does not flag non-memoization React APIs (`useState`, `createContext`, …)", () => {
    expectDiagnosticCount(
      `import React, { useState } from "react";
const Context = React.createContext(null);
const Component = () => {
  const [value, setValue] = useState(0);
  return <Context.Provider value={value}>{setValue}</Context.Provider>;
};`,
      0,
    );
  });

  it('does not flag computed member access `React["useMemo"]()`', () => {
    expectDiagnosticCount(
      `import React from "react";
const Component = () => {
  const cachedValue = React["useMemo"](() => 1, []);
  return <span>{cachedValue}</span>;
};`,
      0,
    );
  });

  it("does not flag `useMemo` referenced without being called", () => {
    expectDiagnosticCount(
      `import { useMemo } from "react";
const reference = useMemo;
export { reference };`,
      0,
    );
  });

  it("does not flag identifier-name collisions in unrelated positions (JSX text, strings)", () => {
    expectDiagnosticCount(
      `const Component = () => (
  <div>
    <span>Why useMemo?</span>
    <code>{"React.memo(Component)"}</code>
  </div>
);`,
      0,
    );
  });

  it("does not flag aliased call when the alias resolves to a non-memoization React API", () => {
    expectDiagnosticCount(
      `import { useState as memoize } from "react";
const Component = () => {
  const [value, setValue] = memoize(0);
  return <button onClick={() => setValue(value + 1)}>{value}</button>;
};`,
      0,
    );
  });

  it("does not flag default-import `React()` direct call (React itself is not a memoization API)", () => {
    expectDiagnosticCount(
      `import React from "react";
const created = React();
export { created };`,
      0,
    );
  });

  it("does not flag `_react.something` when `something` is not a memoization API", () => {
    expectDiagnosticCount(`_react.createContext(null); _react.useState(0);`, 0);
  });

  it("does not flag `Reactosaurus.useMemo()` (canonical-prefix check is exact, not startsWith)", () => {
    expectDiagnosticCount(
      `const cached = Reactosaurus.useMemo(() => 1, []);
export { cached };`,
      0,
    );
  });
});
