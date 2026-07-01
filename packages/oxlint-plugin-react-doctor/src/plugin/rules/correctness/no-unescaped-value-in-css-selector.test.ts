import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedValueInCssSelector } from "./no-unescaped-value-in-css-selector.js";

describe("no-unescaped-value-in-css-selector", () => {
  it("flags a prop string spliced into an attribute selector via a variable", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `const selector = \`[data-tooltip-id='\${id}']\`;
       document.querySelector(selector);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags free text spliced into an inline attribute selector at matches()", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `element.matches(\`[data-scroll-target='\${fieldName}']\`);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a meta-tag lookup keyed on a runtime attribute value", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `document.querySelector(\`meta[property='\${property}']\`);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-chained querySelector with a runtime item id", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `containerRef.current?.querySelector(\`[data-menu-item='\${itemId}']\`);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a numeric loop/grid index", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `tableRef.current?.querySelector(\`[data-row-index='\${rowIndex}']\`);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a common numeric-named variable", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `node.querySelector(\`[data-cell='\${colIndex}']\`);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a compile-time constant used as the attribute name", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `container.querySelector(\`[\${SELECTORS.indexAttribute}='active']\`);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the value is already wrapped in CSS.escape", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `document.querySelector(\`[data-id='\${CSS.escape(id)}']\`);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the quote is escaped by a replace call", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `document.querySelector(\`[data-tooltip-id='\${id.replace(/'/g, "\\\\'")}']\`);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a non-query method with the same shape", () => {
    const result = runRule(
      noUnescapedValueInCssSelector,
      `logger.log(\`[data-tooltip-id='\${id}']\`);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
