import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

interface ForwardedRefFixtureOptions {
  imports?: string;
  wrapper?: string;
  parameters?: string;
  setup?: string;
  notify?: string;
  callback?: string;
}

const createForwardedRefFixture = ({
  imports = 'import React, { forwardRef, useEffect, useState } from "react";',
  wrapper = "forwardRef",
  parameters = "{ onChange }, ref",
  setup = "",
  notify = "if (typeof ref === 'function') ref(handle.current);",
  callback = "",
}: ForwardedRefFixtureOptions = {}): string => `
  ${imports}
  const Widget = ${wrapper}((${parameters}) => {
    const [value] = useState(0);
    const handle = useHandle({ onChange });
    ${setup}
    useEffect(() => {
      ${notify}
      ${callback}
      return () => { if (typeof ref === "function") ref(null); };
    }, [ref, value]);
    return <div />;
  });
`;

const cases: [string, ForwardedRefFixtureOptions, number][] = [
  ["forwards an imperative handle", {}, 0],
  [
    "resolves an imported alias",
    {
      imports: 'import { forwardRef as wrap, useEffect, useState } from "react";',
      wrapper: "wrap",
    },
    0,
  ],
  ["resolves the React namespace", { wrapper: "React.forwardRef" }, 0],
  ["resolves a static namespace member", { wrapper: 'React["forwardRef"]' }, 0],
  [
    "resolves a const factory alias",
    {
      imports: 'import { forwardRef, useEffect, useState } from "react"; const wrap = forwardRef;',
      wrapper: "wrap",
    },
    0,
  ],
  [
    "resolves a destructured factory",
    {
      imports:
        'import React, { useEffect, useState } from "react"; const { forwardRef: wrap } = React;',
      wrapper: "wrap",
    },
    0,
  ],
  [
    "resolves an immutable ref alias",
    { setup: "const attach = ref;", notify: "attach(handle.current);" },
    0,
  ],
  [
    "resolves a const alias chain",
    { setup: "const first = ref; const attach = first;", notify: "attach(handle.current);" },
    0,
  ],
  [
    "resolves a wrapped ref call",
    { notify: "(ref as (handle: unknown) => void)(handle.current);" },
    0,
  ],
  [
    "does not depend on the ref parameter name",
    { parameters: "{ onChange }, attach", notify: "attach(handle.current);" },
    0,
  ],
  [
    "follows an immediate local helper",
    { setup: "const attach = () => ref(handle.current);", notify: "attach();" },
    0,
  ],
  ["keeps a prop notification beside ref attachment", { callback: "onChange(value);" }, 1],
  ["keeps a prop named ref", { parameters: "{ ref }, forwarded", notify: "ref(value);" }, 1],
  ["keeps a prop alias", { setup: "const attach = onChange;", notify: "attach(value);" }, 1],
  [
    "keeps prop notification when the ref is reassigned",
    { setup: "ref = onChange;", notify: "ref(value);", callback: "onChange(value);" },
    1,
  ],
  [
    "keeps prop notification beside a reassigned ref alias",
    {
      setup: "ref = onChange; const attach = ref;",
      notify: "attach(value);",
      callback: "onChange(value);",
    },
    1,
  ],
  [
    "keeps prop notification beside a mutable callback alias",
    {
      setup: "let attach = ref; attach = onChange;",
      notify: "attach(value);",
      callback: "onChange(value);",
    },
    1,
  ],
  [
    "keeps an unknown forwardRef factory",
    { imports: 'import { useEffect, useState } from "react";' },
    1,
  ],
  [
    "keeps an unrelated module factory",
    {
      imports: 'import { forwardRef } from "adapter"; import { useEffect, useState } from "react";',
    },
    1,
  ],
  [
    "keeps a shadowed namespace",
    {
      imports: 'import { useEffect, useState } from "react"; const React = adapter;',
      wrapper: "React.forwardRef",
    },
    1,
  ],
  [
    "keeps a local factory",
    {
      imports:
        'import { useEffect, useState } from "react"; const forwardRef = callback => callback;',
    },
    1,
  ],
  ["keeps a second memo parameter", { wrapper: "React.memo" }, 1],
  [
    "keeps a third forwardRef parameter",
    { parameters: "props, forwarded, ref", notify: "ref(value);" },
    1,
  ],
  [
    "keeps a first forwardRef parameter",
    { parameters: "ref, forwarded", notify: "ref(value);" },
    1,
  ],
  ["keeps a callback property of the ref", { notify: "ref.onChange(value);" }, 1],
];

describe("forwarded ref callback provenance", () => {
  it.each(cases)("%s", (_name, options, diagnosticCount) => {
    const result = runRule(noPassLiveStateToParent, createForwardedRefFixture(options));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("forwarded render callback wrappers", () => {
  it.each([
    ["function expression", "forwardRef(function Render({ onChange }, ref) {", "});"],
    ["wrapped arrow", "forwardRef((({ onChange }, ref) => {", "}));"],
    ["memo wrapper", "React.memo(forwardRef(({ onChange }, ref) => {", "}));"],
  ])("accepts a %s", (_name, start, end) => {
    const code = `
      import React, { forwardRef, useEffect } from "react";
      const Widget = ${start}
        const handle = useHandle({ onChange });
        useEffect(() => { ref(handle.current); }, []);
        return null;
      ${end}
    `;
    const result = runRule(noPassLiveStateToParent, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
