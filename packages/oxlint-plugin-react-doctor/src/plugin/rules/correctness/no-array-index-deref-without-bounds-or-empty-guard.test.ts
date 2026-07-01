import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

describe("no-array-index-deref-without-bounds-or-empty-guard", () => {
  it("flags a regex exec result indexed and dereferenced", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const version = /v(\\d+)/.exec(input)[1].trim();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a string match result indexed and dereferenced", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const first = raw.match(/(\\w+)/)[1].toLowerCase();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags touches[0] deref inside a touchend addEventListener handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchend', (event) => { const y = event.touches[0].clientY; });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags touches[0] deref inside an onTouchEnd JSX handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const el = <div onTouchEnd={(event) => setY(event.touches[0].clientY)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .split(delim)[k] for k >= 1 dereferenced", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const ext = fileName.split('.')[1].toUpperCase();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arithmetic (underflow) index into a runtime-sized parameter array", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function goTo(views, activeViewIndex) { return views[activeViewIndex - 1].id; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag .split(delim)[0]", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const host = url.split('://')[0].toLowerCase();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag touches[0] inside a touchstart handler", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `element.addEventListener('touchstart', (event) => { startY = event.touches[0].clientY; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal index with a dominating length guard", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `if (invoice.lineItems.length) { const first = invoice.lineItems[0].amount; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal index into a local array", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const size = [rect.width, rect.height]; const w = size[0].x;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional-chained deref", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const y = event.touches[0]?.clientY;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a runtime-source arithmetic index guarded by a length check", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function useMenu(items, i) { if (items.length) { return items[i - 1].label; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare-identifier index into a parameter (object-key ambiguous)", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function useMenu(items) { return items[selectedIndex].label; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic object-key read on a reduce accumulator", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `jobs.reduce((acc, job) => { acc[job.teamName] = acc[job.teamName] || []; acc[job.teamName].push(job); return acc; }, {});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string-keyed member write on a parameter dictionary", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `function setVar(styles, breakpoint) { styles[breakpoint]['--gap'] = '0px'; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-literal index into a non-parameter local array", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const arr = [1, 2, 3]; const v = arr[selectedIndex].value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips minified/dist files", () => {
    const result = runRule(
      noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      `const ext = fileName.split('.')[1].toUpperCase();`,
      { filename: "vendor/lib.min.js" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
