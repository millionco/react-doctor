import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferContentInsetAdjustment } from "./rn-prefer-content-inset-adjustment.js";

describe("rn-prefer-content-inset-adjustment", () => {
  it("does NOT flag SafeAreaView around ScrollView", () => {
    const code = `
      const Screen = () => (
        <SafeAreaView>
          <ScrollView />
        </SafeAreaView>
      );
    `;
    const result = runRule(rnPreferContentInsetAdjustment, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag SafeAreaView from react-native-safe-area-context", () => {
    const code = `
      import { SafeAreaView } from "react-native-safe-area-context";
      const Screen = () => (
        <SafeAreaView edges={["top"]}>
          <FlatList data={items} renderItem={renderItem} />
        </SafeAreaView>
      );
    `;
    const result = runRule(rnPreferContentInsetAdjustment, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
