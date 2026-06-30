import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoInlineObjectInListItem } from "./rn-no-inline-object-in-list-item.js";

describe("react-native/rn-no-inline-object-in-list-item — regressions", () => {
  it("stays silent on a style array of StyleSheet refs", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, styles.active]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an inline style object", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={{margin:8}}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a style array containing a fresh object", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, {mt:8}]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
