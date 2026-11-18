import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderLazyStateInit } from "./rerender-lazy-state-init.js";

describe("rerender-lazy-state-init — regressions", () => {
  it("stays silent on useState(useContext(...)) — wrapping would call a hook conditionally", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [theme, setTheme] = useState(useContext(ThemeContext));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on useState(useCustomHook(...))", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [v, setV] = useState(useLocalStorageDefault("k"));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on useState(React.useContext(...)) — member-form hook callee", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [theme] = useState(React.useContext(ThemeContext));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      'import { createContext, useContext as readContext, useState } from "react"; const primary = createContext("theme");',
      "readContext(primary)",
    ],
    ['import { useMemo as readMemo, useState } from "react";', "readMemo(() => 7, [])"],
    ['import { useContext as readContext, useState } from "react";', "readContext?.(primary)"],
    ['import React, { useState } from "react";', 'React["useContext"](primary)'],
    [
      'import * as ReactRuntime from "react"; import { useState } from "react";',
      'ReactRuntime["useContext"](primary)',
    ],
  ])("keeps proven React Hooks in render: %s", (preamble, initializer) => {
    const result = runRule(
      rerenderLazyStateInit,
      `${preamble}
      function Panel() {
        const [value] = useState(${initializer});
        return <span>{value}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "ordinary local function",
      'import { useState } from "react"; function readContext() { return buildLargeTable(); }',
      "readContext(primary)",
    ],
    [
      "foreign named import",
      'import { useState } from "react"; import { useContext as readContext } from "./provider";',
      "readContext(primary)",
    ],
    [
      "type-only declaration",
      'import { useState } from "react"; import type { useContext as readContext } from "react";',
      "readContext(primary)",
    ],
    [
      "type-only specifier",
      'import { type useContext as readContext, useState } from "react";',
      "readContext(primary)",
    ],
    [
      "ordinary non-Hook React import",
      'import { createContext as readContext, useState } from "react";',
      "readContext(primary)",
    ],
    [
      "replacement on the React namespace",
      'import React, { useContext as readContext, useState } from "react"; React.useContext = buildLargeTable;',
      "readContext(primary)",
    ],
    [
      "optional-local-call",
      'import { useState } from "react"; declare const readContext: (() => unknown) | undefined;',
      "readContext?.()",
    ],
    [
      "optional-foreign-alias",
      'import { useState } from "react"; import { useContext as readContext } from "./provider";',
      "readContext?.(Primary)",
    ],
    [
      "optional-type-only-alias",
      'import { type useContext as readContext, useState } from "react";',
      "readContext?.(Primary)",
    ],
    [
      "computed-dynamic-key",
      'import React, { useState } from "react"; declare const hookKey: string;',
      "React[hookKey](Primary)",
    ],
    [
      "computed-foreign-default",
      'import { useState } from "react"; import React from "./provider";',
      'React["useContext"](Primary)',
    ],
    [
      "computed-type-only-default",
      'import { useState } from "react"; import type React from "react";',
      'React["useContext"](Primary)',
    ],
    [
      "computed-replaced-provider",
      'import React, { useState } from "react"; React.useContext = buildLargeTable;',
      'React["useContext"](Primary)',
    ],
    [
      "computed-escaped-provider",
      'import React, { useState } from "react"; registerMutableProvider(React);',
      'React["useContext"](Primary)',
    ],
    [
      "computed-second-provider",
      'import React, { useState } from "react"; import * as Alternate from "react"; Alternate.default.useContext = buildLargeTable;',
      'React["useContext"](Primary)',
    ],
    [
      "computed-optional-invocation",
      'import React, { useState } from "react";',
      'React["useContext"]?.(Primary)',
    ],
    [
      "computed-create-require-provider",
      'import React, { useState } from "react"; const loadReact = require("node:module").createRequire(import.meta.url); loadReact("react").useContext = buildLargeTable;',
      'React["useContext"](Primary)',
    ],
  ])("preserves the warning for %s", (_name, preamble, initializer) => {
    const result = runRule(
      rerenderLazyStateInit,
      `${preamble}
      function Panel() {
        const [value] = useState(${initializer});
        return <span>{value}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "optional-shadowed-alias",
      'import { useContext as readContext, useState } from "react";',
      "readContext?: (context: unknown) => unknown",
      "readContext?.(Primary)",
    ],
    [
      "computed-shadowed-default",
      'import React, { useState } from "react";',
      "React: { useContext: (context: unknown) => unknown }",
      'React["useContext"](Primary)',
    ],
  ])("preserves the warning for %s", (_name, preamble, parameter, initializer) => {
    const result = runRule(
      rerenderLazyStateInit,
      `${preamble}
      function Panel(${parameter}) {
        const [value] = useState(${initializer});
        return <span>{String(value)}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an expensive non-hook initializer call", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [v, setV] = useState(makeBigArray());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an expensive member-form non-hook initializer call", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [v, setV] = useState(utils.makeBigArray());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // atomantic/PortOS MonthView: `useState(now.getMonth())` re-runs a native
  // Date getter that costs nanoseconds — lazy-wrapping it is pure noise.
  it("stays silent on trivial native Date getters", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function MonthView() {
        const now = new Date();
        const [year, setYear] = useState(now.getFullYear());
        const [month, setMonth] = useState(now.getMonth());
        const [timestamp, setTimestamp] = useState(Date.now());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a Date getter shadowed by an argument-taking call", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C({ range }) {
        const [rows, setRows] = useState(calendar.getMonth(range));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  describe("fn-mining sweep: eager calls behind wrapper expressions", () => {
    it("flags an expensive call behind a nullish fallback", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ raw }) {
          const [rows, setRows] = useState(buildRows(raw) ?? []);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an expensive call spread into an array literal", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ raw }) {
          const [rows, setRows] = useState([...buildRows(raw)]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("leaves constructor initializers to no-eager-new-in-use-state-initializer", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ config }) {
          const [model, setModel] = useState(new HeavyModel(config));
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("flags a member read off an expensive call", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ width }) {
          const [sections, setSections] = useState(computeLayout(width).sections);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on trivial built-in constructors", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [when, setWhen] = useState(new Date());
          const [seen, setSeen] = useState(new Set());
          const [byId, setById] = useState(new Map());
          const [weakSeen, setWeakSeen] = useState(new WeakSet());
          const [weakById, setWeakById] = useState(new WeakMap());
          const [controller, setController] = useState(new AbortController());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on an already-lazy empty-container initializer", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byId, setById] = useState(() => new Map());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when only the conditional right side of a fallback is a call", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C({ value }) {
          const [v, setV] = useState(value ?? getDefault());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on member reads that involve no call", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C({ config }) {
          const [sections, setSections] = useState(config.layout.sections);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a hook call behind a nullish fallback", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [theme, setTheme] = useState(useContext(ThemeContext) ?? "light");
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("constructor ownership", () => {
    it("leaves a trivial-name construction with runtime arguments to the constructor rule", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byKey, setByKey] = useState(new Map([["a", 1]]));
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("leaves both argument-taking and empty constructors to the constructor rule", () => {
      const withArgument = runRule(
        rerenderLazyStateInit,
        `function C({ timestamp }) {
          const [startedAt] = useState(new Date(timestamp));
          return null;
        }`,
      );
      const zeroArgument = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [startedAt] = useState(new Date());
          return null;
        }`,
      );
      expect(withArgument.diagnostics).toEqual([]);
      expect(zeroArgument.diagnostics).toEqual([]);
    });

    it("leaves member-expression constructors to the constructor rule", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byKey] = useState(new ns.Map());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when only TYPE arguments are passed", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byKey] = useState(new Map<string, number>());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("flags a TS-wrapped expensive call (wrapper transparency)", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C({ raw }) {
          const [rows, setRows] = useState(buildRows(raw) as Rows);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});

describe("cheap primitive string conversion", () => {
  it.each([
    "const width = 320; useState((width - 20).toString());",
    "useState((42).toString());",
    'useState("ready".toString());',
    "const width: number = readWidth(); useState(width.toString());",
    'const {width, height} = Dimensions.get("window"); useState((width - 20).toString()); useState(height.toString());',
    'const {height: size} = Dimensions.get("screen"); useState(size.toString());',
  ])("accepts cheap primitive conversion: %s", (body) => {
    const result = runRule(
      rerenderLazyStateInit,
      `import {useState} from 'react'; import {Dimensions} from 'react-native'; const Panel = () => { ${body} return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "useState(buildModel().toString());",
    "const model = {toString: expensive}; useState(model.toString());",
    "const width = input; useState(width.toString());",
    'const Dimensions = custom; const {height} = Dimensions.get("window"); useState(height.toString());',
    "const width = 320; useState((width - expensive()).toString());",
    "let width = 320; width = model; useState(width.toString());",
    'Dimensions.get = custom; const {height} = Dimensions.get("window"); useState(height.toString());',
  ])("keeps warnings for unproven or expensive conversion: %s", (body) => {
    const result = runRule(
      rerenderLazyStateInit,
      `import {useState} from 'react'; import {Dimensions} from 'react-native'; const Panel = () => { ${body} return null; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
