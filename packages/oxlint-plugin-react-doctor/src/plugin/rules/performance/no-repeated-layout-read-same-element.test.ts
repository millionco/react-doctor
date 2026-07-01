import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedLayoutReadSameElement } from "./no-repeated-layout-read-same-element.js";

describe("no-repeated-layout-read-same-element", () => {
  it("flags two getBoundingClientRect() reads on the same element", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function place(el) {
        const top = el.getBoundingClientRect().top;
        const bottom = el.getBoundingClientRect().bottom;
        return top + bottom;
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags two rect reads on the same ref within one expression", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function place(collaboratorRef) {
        return (
          collaboratorRef.current.getBoundingClientRect().top +
          collaboratorRef.current.getBoundingClientRect().height / 2
        );
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags repeated getComputedStyle on the same element", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function read(el) {
        const a = getComputedStyle(el).width;
        const b = getComputedStyle(el).height;
        return [a, b];
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags window.getComputedStyle repeated on the same element", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function read(el) {
        const a = window.getComputedStyle(el).width;
        const b = window.getComputedStyle(el).height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports only once for three reads on the same element", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function place(el) {
        const a = el.getBoundingClientRect().top;
        const b = el.getBoundingClientRect().left;
        const c = el.getBoundingClientRect().right;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag reads on different elements", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function place(tooltipEl, parentEl) {
        const a = tooltipEl.getBoundingClientRect().top;
        const b = parentEl.getBoundingClientRect().bottom;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads in two different function scopes", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function first(el) {
        return el.getBoundingClientRect().top;
      }
      function second(el) {
        return el.getBoundingClientRect().bottom;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single destructured read", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function place(el) {
        const { width, height } = el.getBoundingClientRect();
        return width + height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag read-mutate-read when a style write intervenes", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function measure(el) {
        const before = el.getBoundingClientRect();
        el.style.height = 'auto';
        const after = el.getBoundingClientRect();
        return after.height - before.height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag read-method-read when a mutating call intervenes", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function measure(el) {
        const before = el.getBoundingClientRect();
        el.scrollIntoView();
        const after = el.getBoundingClientRect();
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads in separate branches", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function place(el, flag) {
        if (flag) {
          return el.getBoundingClientRect().top;
        } else {
          return el.getBoundingClientRect().bottom;
        }
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
