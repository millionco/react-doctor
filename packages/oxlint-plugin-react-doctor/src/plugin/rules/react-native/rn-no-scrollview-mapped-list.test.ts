import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoScrollviewMappedList } from "./rn-no-scrollview-mapped-list.js";

const expectFail = (code: string): void => {
  const result = runRule(rnNoScrollviewMappedList, code, { filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(rnNoScrollviewMappedList, code, { filename: "App.native.tsx" });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("react-native/rn-no-scrollview-mapped-list", () => {
  it("fires on a mapped list inside a ScrollView", () => {
    expectFail(`
      const App = () => (
        <ScrollView>{items.map((item) => <Row key={item.id} />)}</ScrollView>
      );
    `);
  });

  it("does not fire on a static ScrollView", () => {
    expectPass(`const App = () => <ScrollView><Row /></ScrollView>;`);
  });

  describe("expo universal ui ScrollView", () => {
    it("does not fire on a mapped list inside an @expo/ui ScrollView", () => {
      expectPass(`
        import { Host, ScrollView } from "@expo/ui";
        const App = () => (
          <Host>
            <ScrollView>{items.map((item) => <Row key={item.id} />)}</ScrollView>
          </Host>
        );
      `);
    });

    it("does not fire on a platform-specific @expo/ui subpath import", () => {
      expectPass(`
        import { ScrollView } from "@expo/ui/swift-ui";
        const App = () => <ScrollView>{items.map((item) => <Row key={item.id} />)}</ScrollView>;
      `);
    });

    it("does not fire on a namespace import", () => {
      expectPass(`
        import * as ExpoUI from "@expo/ui";
        const App = () => (
          <ExpoUI.ScrollView>{items.map((item) => <Row key={item.id} />)}</ExpoUI.ScrollView>
        );
      `);
    });

    it("still fires on a ScrollView imported from react-native", () => {
      expectFail(`
        import { ScrollView } from "react-native";
        const App = () => <ScrollView>{items.map((item) => <Row key={item.id} />)}</ScrollView>;
      `);
    });
  });
});
