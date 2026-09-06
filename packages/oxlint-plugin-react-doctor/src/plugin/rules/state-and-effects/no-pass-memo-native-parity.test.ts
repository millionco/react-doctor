import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

describe("parent data memo callee spelling parity", () => {
  it.each([
    {
      name: "memo-nested-transform-bare-control",
      source:
        "import {useEffect,useMemo,useState} from 'react'; import {normalize} from 'data-library'; export function Child({items,onChange}) { const [search]=useState(''); const value=useMemo(()=>{const term=normalize(search);return items.filter(item=>normalize(item.label).includes(term));},[items,search]);useEffect(()=>{onChange(value)},[value]);return null;}",
      expectedCount: 1,
    },
    {
      name: "memo-nested-transform-namespace",
      source:
        "import React,{useEffect,useState} from 'react'; import {normalize} from 'data-library'; export function Child({items,onChange}) { const [search]=useState(''); const value=React.useMemo(()=>{const term=normalize(search);return items.filter(item=>normalize(item.label).includes(term));},[items,search]);useEffect(()=>{onChange(value)},[value]);return null;}",
      expectedCount: 0,
    },
    {
      name: "memo-nested-transform-renamed-import",
      source:
        "import {useEffect,useMemo as memoize,useState} from 'react'; import {normalize} from 'data-library'; export function Child({items,onChange}) { const [search]=useState(''); const value=memoize(()=>{const term=normalize(search);return items.filter(item=>normalize(item.label).includes(term));},[items,search]);useEffect(()=>{onChange(value)},[value]);return null;}",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(noPassDataToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
