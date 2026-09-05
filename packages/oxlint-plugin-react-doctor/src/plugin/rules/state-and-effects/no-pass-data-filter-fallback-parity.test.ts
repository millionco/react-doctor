import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

describe("no-pass-data-to-parent — inline filter fallback parity", () => {
  it.each([
    {
      name: "parent-filter-call-literal-fallback",
      source:
        "import {useEffect} from 'react'; export function Child({items,onChange}) { useEffect(()=>{ const value=items.filter(item=>item.enabled)||[]; onChange(value); },[items]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "parent-filter-call-imported-fallback",
      source:
        "import {useEffect} from 'react'; import {readItems} from 'data-library'; export function Child({items,onChange}) { useEffect(()=>{ const value=items.filter(item=>item.enabled)||readItems(); onChange(value); },[items]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "parent-filter-call-child-set-imported-fallback",
      source:
        "import {useEffect} from 'react'; import {readItems} from 'data-library'; export function Child({items,onChange}) { const selected=new Set(['a']); useEffect(()=>{ const value=items.filter(item=>selected.has(item.id))||readItems(); onChange(value); },[items]); return null; }",
      expectedDiagnostics: [
        {
          column: 230,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "parent-filter-bound-call-child-set-fallback",
      source:
        "import {useEffect} from 'react'; export function Child({items,onChange}) { const selected=new Set(['a']); useEffect(()=>{ const filtered=items.filter(item=>selected.has(item.id)); const value=filtered||[]; onChange(value); },[items]); return null; }",
      expectedDiagnostics: [],
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    const result = runRule(noPassDataToParent, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
