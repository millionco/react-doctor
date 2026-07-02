import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveTabindex } from "./no-noninteractive-tabindex.js";

const disallowExpressionValuesSettings = {
  "react-doctor": {
    noNoninteractiveTabindex: { allowExpressionValues: false },
  },
};

describe("a11y/no-noninteractive-tabindex regressions", () => {
  describe("refs do not exempt (refs imply measurement/observers, not focus management)", () => {
    it("fires on a div with tabIndex and a measurement ref", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} ref={measureRef}>static text</div>`)
          .diagnostics,
      ).toHaveLength(1);
    });

    it("fires on an article with tabIndex and an IntersectionObserver ref", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<article tabIndex="0" ref={observerRef} />`).diagnostics,
      ).toHaveLength(1);
    });

    it("fires on a bare div with tabIndex", () => {
      expect(runRule(noNoninteractiveTabindex, `<div tabIndex={0} />`).diagnostics).toHaveLength(1);
    });
  });

  describe("keyboard handlers exempt (roving focus / modal keyboard wiring)", () => {
    it("stays silent on a div with tabIndex and onKeyDown", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={0} onKeyDown={handleKeyDown} />`)
          .diagnostics,
      ).toEqual([]);
    });

    it("stays silent on a div with tabIndex, onKeyDown, and a ref", () => {
      expect(
        runRule(
          noNoninteractiveTabindex,
          `<div tabIndex={0} ref={containerRef} onKeyDown={handleKeyDown} />`,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("allowExpressionValues: false honors the keyboard guard", () => {
    it("stays silent on an expression tabIndex with onKeyDown", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={someVar} onKeyDown={handleKey} />`, {
          settings: disallowExpressionValuesSettings,
        }).diagnostics,
      ).toEqual([]);
    });

    it("still fires on an expression tabIndex without keyboard wiring", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={someVar} />`, {
          settings: disallowExpressionValuesSettings,
        }).diagnostics,
      ).toHaveLength(1);
    });

    it("still fires on an expression tabIndex with only a ref", () => {
      expect(
        runRule(noNoninteractiveTabindex, `<div tabIndex={someVar} ref={containerRef} />`, {
          settings: disallowExpressionValuesSettings,
        }).diagnostics,
      ).toHaveLength(1);
    });
  });
});
