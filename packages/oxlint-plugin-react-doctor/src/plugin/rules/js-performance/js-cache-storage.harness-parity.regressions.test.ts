import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCacheStorage } from "./js-cache-storage.js";

const countDiagnostics = (code: string): number => {
  const result = runRule(jsCacheStorage, code);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

// PR #994 fp-review: the harness previously dispatched only enter visitors
// (plus a special-cased Program:exit), so the rule's ":exit" handlers never
// popped the per-function count stack and every read after the first
// function landed in a stale map. These probes pin the production oxlint
// semantics now that the harness dispatches `${type}:exit` post-order.
describe("js-performance/js-cache-storage — :exit dispatch parity", () => {
  it("does not sum a function-body read with a later module-scope read of the same key", () => {
    expect(
      countDiagnostics(`
        function warm() { localStorage.getItem('token') }
        const token = localStorage.getItem('token')
        console.log(token, warm)
      `),
    ).toBe(0);
  });

  it("does not sum an arrow-body read with a later module-scope read of the same key", () => {
    expect(
      countDiagnostics(`
        const warm = () => localStorage.getItem('token')
        const token = localStorage.getItem('token')
        console.log(token, warm)
      `),
    ).toBe(0);
  });

  it("does not sum a function-expression read with a later module-scope read of the same key", () => {
    expect(
      countDiagnostics(`
        const warm = function () { return localStorage.getItem('token') }
        const token = localStorage.getItem('token')
        console.log(token, warm)
      `),
    ).toBe(0);
  });

  it("still flags two module-scope reads separated by an unrelated function declaration", () => {
    expect(
      countDiagnostics(`
        const first = localStorage.getItem('token')
        function unrelated() { return 1 }
        const second = localStorage.getItem('token')
        console.log(first, second, unrelated)
      `),
    ).toBe(1);
  });

  it("mined FP: single reads in sibling nested functions inside a component stay silent", () => {
    expect(
      countDiagnostics(`
        import { useEffect, useState } from 'react'
        export const SectionsColumn = ({ selectedSectionSlugs }) => {
          const [sectionSlugs, setSectionSlugs] = useState([])
          useEffect(() => {
            const data = localStorage.getItem('current-slug-list')
            const slugList = data === null ? [] : data.split(',')
            setSectionSlugs(slugList)
          }, [])
          const resetSelectedSections = () => {
            const data = localStorage.getItem('current-slug-list')
            setSectionSlugs(data ? data.split(',') : [])
          }
          return null
        }
      `),
    ).toBe(0);
  });

  it("still flags two reads of the same key in the same useEffect callback", () => {
    expect(
      countDiagnostics(`
        import { useEffect } from 'react'
        export const C = () => {
          useEffect(() => {
            const slugList = localStorage.getItem('current-slug-list') === null
              ? []
              : localStorage.getItem('current-slug-list').split(',')
            console.log(slugList)
          }, [])
          return null
        }
      `),
    ).toBe(1);
  });
});
