import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoInlineFlatlistRenderitem } from "./rn-no-inline-flatlist-renderitem.js";

describe("react-native/rn-no-inline-flatlist-renderitem — regressions", () => {
  it("flags an inline arrow renderItem on FlatList", () => {
    const result = runRule(
      rnNoInlineFlatlistRenderitem,
      `import { FlatList } from "react-native";
      const Feed = ({ items }) => (
        <FlatList data={items} renderItem={({ item }) => <Row item={item} />} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("FlatList");
  });

  it("stays silent when renderItem is a named function reference", () => {
    const result = runRule(
      rnNoInlineFlatlistRenderitem,
      `import { FlatList } from "react-native";
      const renderRow = ({ item }) => <Row item={item} />;
      const Feed = ({ items }) => <FlatList data={items} renderItem={renderRow} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on inline renderItem props of non-list components", () => {
    const result = runRule(
      rnNoInlineFlatlistRenderitem,
      `const Feed = ({ items }) => (
        <Carousel data={items} renderItem={({ item }) => <Row item={item} />} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
