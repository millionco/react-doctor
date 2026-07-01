import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEagerNewInUseStateInitializer } from "./no-eager-new-in-use-state-initializer.js";

describe("no-eager-new-in-use-state-initializer", () => {
  it("flags useState(new Set())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [seen] = useState(new Set<string>());
      }
    `
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new Set()");
  });

  it("flags useState(new Map())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [cache] = useState(new Map());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags useState(new Date())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [now] = useState(new Date());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a side-effecting constructor (new IntersectionObserver)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [observer] = useState(new IntersectionObserver((e) => {}));
      }
    `
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(
      "new IntersectionObserver()"
    );
  });

  it("flags useState(new AbortController())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [controller] = useState(new AbortController());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a typed React.useState(new Map())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import React from "react";
      function Component() {
        const [m] = React.useState<Map<string, number>>(new Map());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the lazy form useState(() => new X())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [seen] = useState(() => new Set());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain CallExpression initializer (owned by rerender-lazy-state-init)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [thing] = useState(makeThing());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not chase an identifier initializer", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const initial = new Set();
        const [seen] = useState(initial);
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new inside a setter updater callback", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [seen, setSeen] = useState(() => new Set());
        const add = (x) => setSeen((prev) => new Set(prev).add(x));
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag useRef(new X()) (owned by rerender-lazy-ref-init)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useRef } from "react";
      function Component() {
        const ref = useRef(new Map());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag trivial constructors (new Array / new Object)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [a] = useState(new Array());
        const [o] = useState(new Object());
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag useState with no arguments", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [x] = useState();
      }
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a new expression in a conditional branch", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ enabled }) {
        const [c] = useState(enabled ? new AbortController() : null);
      }
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
