import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnBottomSheetPreferNative } from "./rn-bottom-sheet-prefer-native.js";

describe("rn-bottom-sheet-prefer-native", () => {
  it("does not flag @gorhom/bottom-sheet", () => {
    const code = `import BottomSheet from "@gorhom/bottom-sheet";
`;
    const result = runRule(rnBottomSheetPreferNative, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags legacy JS bottom sheet packages", () => {
    const code = `import RawBottomSheet from "react-native-raw-bottom-sheet";
`;
    const result = runRule(rnBottomSheetPreferNative, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("react-native-raw-bottom-sheet");
    expect(result.diagnostics[0].message).toContain("prefer <Modal");
  });
});
