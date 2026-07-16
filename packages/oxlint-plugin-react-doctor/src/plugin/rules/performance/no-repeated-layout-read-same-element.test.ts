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
    expect(result.diagnostics[0].message).toContain("const style = getComputedStyle(el)");
    expect(result.diagnostics[0].message).not.toContain("el.getComputedStyle");
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

  it("does not flag getComputedStyle plus getBoundingClientRect on the same element (canonical measure-an-element idiom)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function measure(el) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return rect.height - parseFloat(style.paddingTop);
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a same-method repeat when a different-method read is also present", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function measure(el) {
        const style = getComputedStyle(el);
        const top = el.getBoundingClientRect().top;
        const bottom = el.getBoundingClientRect().bottom;
        return [style, top, bottom];
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag getComputedStyle with different pseudo-element selectors (::before/::after content reads)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function pseudo(el) {
        const before = getComputedStyle(el, '::before').content;
        const after = getComputedStyle(el, '::after').content;
        return [before, after];
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads in different switch cases (per-placement edge lookup)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function edge(el, placement) {
        switch (placement) {
          case 'top':
            return el.getBoundingClientRect().top;
          case 'bottom':
            return el.getBoundingClientRect().bottom;
        }
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads in the two arms of a ternary (axis-conditional measurement)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function size(el, horizontal) {
        return horizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads in unbraced if/else branches", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function edge(el, flag) {
        if (flag) return el.getBoundingClientRect().top;
        else return el.getBoundingClientRect().bottom;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag re-measure after Object.assign(el.style, …) between reads (floating-ui apply-styles idiom)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function measure(el) {
        const before = el.getBoundingClientRect();
        Object.assign(el.style, { height: 'auto' });
        const after = el.getBoundingClientRect();
        return after.height - before.height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag re-measure after a helper call receiving the element (measure -> apply -> re-measure)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function measure(el) {
        const before = el.getBoundingClientRect();
        applyCollapsedStyles(el);
        const after = el.getBoundingClientRect();
        return after.height - before.height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag re-measure after an assignment whose right-hand side contains the first read", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function collapse(el) {
        el.style.height = el.getBoundingClientRect().height / 2 + 'px';
        const after = el.getBoundingClientRect();
        return after.height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag lazy fallback reads in logical right operands (clientWidth || rect fallback)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function setup(canvas) {
        const w = canvas.clientWidth || canvas.getBoundingClientRect().width;
        const h = canvas.clientHeight || canvas.getBoundingClientRect().height;
        return [w, h];
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a short-circuit fast-path read followed by an unconditional read", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function isVisible(el) {
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden';
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags repeated reads sitting in logical LEFT operands (rect.left || 0 defaults)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function offsets(el, event) {
        const x = event.clientX - (el.getBoundingClientRect().left || 0);
        const y = event.clientY - (el.getBoundingClientRect().top || 0);
        return [x, y];
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags two reads inside the same logical right operand", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      function size(el, useRect) {
        return useRect && el.getBoundingClientRect().width + el.getBoundingClientRect().height;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag re-measure across an await (next-frame async re-measurement)", () => {
    const result = runRule(
      noRepeatedLayoutReadSameElement,
      `
      async function measure(el) {
        const before = el.getBoundingClientRect();
        await new Promise(requestAnimationFrame);
        const after = el.getBoundingClientRect();
        return after.top - before.top;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
