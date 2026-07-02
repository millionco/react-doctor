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

  it("flags a logical-AND fresh object inside a style array", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, item.active && { opacity: 0.5 }]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a ternary fresh object inside a style array", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, item.active ? { opacity: 0.5 } : null]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a nested style array containing a fresh object", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, [styles.inner, { marginTop: 8 }]]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a spread fresh object inside a style array", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, ...[{ marginTop: 8 }]]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a fresh non-style array prop on a custom row component", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<Row ids={[item.a, item.b]} />)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a contentContainerStyle array of StyleSheet refs", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<ScrollView contentContainerStyle={[styles.row, styles.active]}><Text>{item.name}</Text></ScrollView>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a style array of conditional StyleSheet refs", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, item.active && styles.active]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not throw on a style array hole", () => {
    const result = runRule(
      rnNoInlineObjectInListItem,
      `const C = () => (<FlatList renderItem={({item}) => (<View style={[styles.row, , styles.active]}><Text>{item.name}</Text></View>)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
