import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonLiteralSelectorQueryWithoutTryCatch } from "./no-non-literal-selector-query-without-try-catch.js";

describe("no-non-literal-selector-query-without-try-catch", () => {
  it("flags closest() on a value from an href-named helper", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const targetSelector = getHashFromHref(el); el.closest(targetSelector);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags querySelector on a getAttribute('href') value", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = elementRef.current.getAttribute('href'); document.querySelector(selector);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags matches() on a location.hash argument", () => {
    const result = runRule(noNonLiteralSelectorQueryWithoutTryCatch, `el.matches(location.hash);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a string-literal selector", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `document.querySelector('.foo > a');`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CSS-module template interpolation", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      "node.querySelector(`.${styles['dismiss-button']}`);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a SCREAMING_SNAKE selector constant", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const FOCUSABLE_ELEMENTS_SELECTOR = 'a, button'; container.querySelectorAll(FOCUSABLE_ELEMENTS_SELECTOR);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an opaque props selector value", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const target = document.querySelector(props.targetSelector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CSS.escape-wrapped template", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      "container.querySelector(`#${CSS.escape(id)}`);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an href selector already wrapped in try/catch", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = el.getAttribute('href'); try { document.querySelector(selector); } catch (error) {}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic computed query method", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = el.getAttribute('href'); document[method](selector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag getAttribute for a non-href attribute", () => {
    const result = runRule(
      noNonLiteralSelectorQueryWithoutTryCatch,
      `const selector = el.getAttribute('data-target'); document.querySelector(selector);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
