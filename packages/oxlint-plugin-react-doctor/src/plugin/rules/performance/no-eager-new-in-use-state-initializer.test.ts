import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEagerNewInUseStateInitializer } from "./no-eager-new-in-use-state-initializer.js";

describe("no-eager-new-in-use-state-initializer", () => {
  it("does not flag the empty-Set selection-state idiom useState(new Set())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [seen] = useState(new Set<string>());
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the empty-Map keyed-state idiom useState(new Map())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [cache] = useState(new Map());
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the current-date default idiom useState(new Date())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [now] = useState(new Date());
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Set seeded with constant identifiers (agent-teams-ai idiom)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [enabled] = useState(new Set([TAB_ONE, TAB_TWO, TAB_THREE]));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Date fallback in a logical initializer (TaskTrove idiom)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ initialDate }) {
        const [date] = useState(initialDate || new Date());
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Map seeded from constant prop entries", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ defaults }) {
        const [settings] = useState(new Map([["theme", defaults.theme]]));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the zero-arg DOM geometry idiom useState<DOMRect>(new DOMRect()) (agent-teams-ai idiom)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [anchorRect, setAnchorRect] = useState<DOMRect>(new DOMRect());
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a DOMPoint built from constant coordinates", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [origin] = useState(new DOMPoint(0, 0));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a DOM geometry constructor fed a call result (new DOMRect(...measure()))", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ element }) {
        const [rect] = useState(new DOMRect(0, 0, measureWidth(element), 0));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new DOMRect()");
  });

  it("flags a cheap builtin rebuilt from a call result (new Map(items.map(...)))", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ items }) {
        const [byId] = useState(new Map(items.map((item) => [item.id, item])));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new Map()");
  });

  it("flags a user-defined class constructor", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      import { AudioEngine } from "./audio-engine";
      function Component() {
        const [engine] = useState(new AudioEngine());
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new AudioEngine()");
  });

  it("flags a side-effecting constructor (new IntersectionObserver)", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [observer] = useState(new IntersectionObserver((e) => {}));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new IntersectionObserver()");
  });

  it("flags useState(new AbortController())", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component() {
        const [controller] = useState(new AbortController());
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a typed React.useState with a call-fed Map", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import React from "react";
      function Component({ entries }) {
        const [m] = React.useState<Map<string, number>>(new Map(Object.entries(entries)));
      }
    `,
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
    `,
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
    `,
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
    `,
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
    `,
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
    `,
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
    `,
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
    `,
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
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the non-trivial branch even when the other branch is an exempt constructor", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ flag }) {
        const [c] = useState(flag ? new Array() : new AbortController());
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new AbortController()");
  });

  it("flags the non-trivial side of a logical initializer with an exempt left side", () => {
    const result = runRule(
      noEagerNewInUseStateInitializer,
      `
      import { useState } from "react";
      function Component({ items }) {
        const [c] = useState(new Boolean(false) && new Map(items.map((item) => [item.id, item])));
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
