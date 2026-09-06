import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

describe("no-pass-data-to-parent — native handler and fallback parity", () => {
  it("retains child state captured alongside parent data by a memoized function", () => {
    const source =
      "import {useMemo,useEffect,useState} from 'react'; export function Child({onReady,value}) { const [count]=useState(0); const handle=useMemo(()=>()=>[value,count],[]); useEffect(()=>{onReady(handle)},[handle]); return null; }";
    const result = runRule(noPassDataToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    {
      name: "memo-function-parent-reader-control",
      source:
        "import {useMemo,useEffect} from 'react'; export function Child({onReady,onRead}) { const handle=useMemo(()=>()=>onRead(),[]); useEffect(()=>{onReady(handle)},[handle]); return null; }",
    },
    {
      name: "memo-function-parent-reader-bag-control",
      source:
        "import {useMemo,useEffect,useRef} from 'react'; export function Child({onReady,onRead}) { const readyRef=useRef(onReady); const handle=useMemo(()=>()=>onRead(),[]); useEffect(()=>{readyRef.current({handle})},[handle]); return null; }",
    },
    {
      name: "memo-function-parent-value-control",
      source:
        "import {useMemo,useEffect} from 'react'; export function Child({onReady,value}) { const handle=useMemo(()=>()=>value,[]); useEffect(()=>{onReady(handle)},[handle]); return null; }",
    },
  ])("$name", ({ source }) => {
    const result = runRule(noPassDataToParent, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each([
    {
      name: "ref-handler-bag-use-callback",
      source:
        "import { useCallback, useEffect, useRef } from 'react'; import { read } from 'data-service'; export function Child({ onReady }) { const readyRef = useRef(onReady); const handle = useCallback(() => read(), []); useEffect(() => { readyRef.current({ handle, inline: () => read() }); }, [handle]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "ref-handler-bag-use-callback-member",
      source:
        "import * as React from 'react'; import { read } from 'data-service'; export function Child({ onReady }) { const readyRef = React.useRef(onReady); const handle = React.useCallback(() => read(), []); React.useEffect(() => { readyRef.current({ handle }); }, [handle]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "ref-handler-bag-use-callback-with-data",
      source:
        "import { useCallback, useEffect, useRef } from 'react'; import { read } from 'data-service'; export function Child({ onReady }) { const readyRef = useRef(onReady); const handle = useCallback(() => read(), []); useEffect(() => { readyRef.current({ handle, value: read() }); }, [handle]); return null; }",
      expectedDiagnostics: [
        {
          column: 228,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "ref-handler-bag-renamed-use-callback",
      source:
        "import { useCallback as memoize, useEffect, useRef } from 'react'; import { read } from 'data-service'; export function Child({ onReady }) { const readyRef = useRef(onReady); const handle = memoize(() => read(), []); useEffect(() => { readyRef.current({ handle }); }, [handle]); return null; }",
      expectedDiagnostics: [
        {
          column: 235,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "ref-handler-bag-use-memo",
      source:
        "import { useMemo, useEffect, useRef } from 'react'; import { read } from 'data-service'; export function Child({ onReady }) { const readyRef = useRef(onReady); const handle = useMemo(() => () => read(), []); useEffect(() => { readyRef.current({ handle }); }, [handle]); return null; }",
      expectedDiagnostics: [
        {
          column: 226,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "ref-handler-bag-callback-identifier-argument",
      source:
        "import { useCallback, useEffect, useRef } from 'react'; import { read } from 'data-service'; export function Child({ onReady }) { const readyRef = useRef(onReady); const work = () => read(); const handle = useCallback(work, []); useEffect(() => { readyRef.current({ handle }); }, [handle]); return null; }",
      expectedDiagnostics: [
        {
          column: 247,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-namespace-nested-local-imported-transform",
      source:
        "import * as React from 'react'; import { normalize } from 'data-library'; export function Child({ items, onChange }) { const [search] = React.useState(''); const value = React.useMemo(() => { const term = normalize(search); return items.filter(item => normalize(item.label).includes(term)); }, [items, search]); React.useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-renamed-nested-local-imported-transform",
      source:
        "import { useEffect, useMemo as memoize, useState } from 'react'; import { normalize } from 'data-library'; export function Child({ items, onChange }) { const [search] = useState(''); const value = memoize(() => { const term = normalize(search); return items.filter(item => normalize(item.label).includes(term)); }, [items, search]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 351,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-chain-nullish-fallback",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert, isDefined } from 'data-library'; export function Child({ config, onChange }) { const value = useMemo(() => { const items = config.items ?? []; const filtered = items.filter(item => item.enabled); return filtered.map(item => convert(item)).filter(isDefined); }, [config]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-filter-chain-or-fallback",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert, isDefined } from 'data-library'; export function Child({ config, onChange }) { const value = useMemo(() => { const items = config.items || []; const filtered = items.filter(item => item.enabled); return filtered.map(item => convert(item)).filter(isDefined); }, [config]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-filter-chain-child-fallback",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert, isDefined, readItems } from 'data-library'; export function Child({ config, onChange }) { const value = useMemo(() => { const items = config.items ?? readItems(); const filtered = items.filter(item => item.enabled); return filtered.map(item => convert(item)).filter(isDefined); }, [config]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-filter-chain-populated-literal-fallback",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert, isDefined } from 'data-library'; export function Child({ config, onChange }) { const value = useMemo(() => { const items = config.items ?? [{ enabled: true }]; const filtered = items.filter(item => item.enabled); return filtered.map(item => convert(item)).filter(isDefined); }, [config]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    const result = runRule(noPassDataToParent, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
