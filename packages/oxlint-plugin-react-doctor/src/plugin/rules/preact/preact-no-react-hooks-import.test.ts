import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preactNoReactHooksImport } from "./preact-no-react-hooks-import.js";

describe("preact-no-react-hooks-import", () => {
  it('flags `import { useState } from "react"` in a pure-Preact project', () => {
    const result = runRule(
      preactNoReactHooksImport,
      `
      import { useState } from "react";
      const Counter = () => {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount((n) => n + 1)}>{count}</button>;
      };
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("preact/hooks");
    expect(result.diagnostics[0].message).toContain("useState");
  });

  it("flags multiple hooks in one statement and lists them all", () => {
    const result = runRule(
      preactNoReactHooksImport,
      `
      import { useState, useEffect, useMemo } from "react";
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useState");
    expect(result.diagnostics[0].message).toContain("useEffect");
    expect(result.diagnostics[0].message).toContain("useMemo");
  });

  it("does not flag imports from `preact/hooks`", () => {
    const result = runRule(
      preactNoReactHooksImport,
      `
      import { useState, useEffect } from "preact/hooks";
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-hook imports from `react`", () => {
    const result = runRule(
      preactNoReactHooksImport,
      `
      import { Fragment, Children } from "react";
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag `import React from "react"` (default import only)', () => {
    const result = runRule(
      preactNoReactHooksImport,
      `
      import React from "react";
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags hooks even when mixed with the React default import", () => {
    const result = runRule(
      preactNoReactHooksImport,
      `
      import React, { useState } from "react";
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useState");
  });
});
