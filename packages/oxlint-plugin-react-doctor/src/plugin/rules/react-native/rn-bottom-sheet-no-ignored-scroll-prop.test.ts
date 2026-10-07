import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnBottomSheetNoIgnoredScrollProp } from "./rn-bottom-sheet-no-ignored-scroll-prop.js";

describe("rn-bottom-sheet-no-ignored-scroll-prop", () => {
  it("flags every ignored prop on BottomSheetScrollView", () => {
    const code = `
      import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
      const Screen = () => (
        <BottomSheetScrollView
          scrollEventThrottle={16}
          decelerationRate="fast"
          onScrollBeginDrag={handleDrag}
        />
      );
    `;
    const result = runRule(rnBottomSheetNoIgnoredScrollProp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scrollEventThrottle"),
        expect.stringContaining("decelerationRate"),
        expect.stringContaining("onScrollBeginDrag"),
      ]),
    );
  });

  it("resolves aliased and namespace imports", () => {
    const code = `
      import { BottomSheetScrollView as SheetScroll } from "@gorhom/bottom-sheet";
      import * as Gorhom from "@gorhom/bottom-sheet";
      const First = () => <SheetScroll scrollEventThrottle={16} />;
      const Second = () => <Gorhom.BottomSheetScrollView decelerationRate="normal" />;
    `;
    const result = runRule(rnBottomSheetNoIgnoredScrollProp, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows supported props and unresolved spreads", () => {
    const code = `
      import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
      const Screen = () => (
        <BottomSheetScrollView {...scrollProps} onScroll={handleScroll} />
      );
    `;
    const result = runRule(rnBottomSheetNoIgnoredScrollProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores same-named components from other modules", () => {
    const code = `
      import { BottomSheetScrollView } from "./bottom-sheet-scroll-view";
      const Screen = () => <BottomSheetScrollView scrollEventThrottle={16} />;
    `;
    const result = runRule(rnBottomSheetNoIgnoredScrollProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a locally shadowed Gorhom import", () => {
    const code = `
      import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
      const Screen = ({ BottomSheetScrollView }) => (
        <BottomSheetScrollView scrollEventThrottle={16} />
      );
    `;
    const result = runRule(rnBottomSheetNoIgnoredScrollProp, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
