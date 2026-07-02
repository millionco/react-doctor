import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnListCallbackPerRow } from "./rn-list-callback-per-row.js";

describe("react-native/rn-list-callback-per-row — regressions", () => {
  it("reports a nested-list inline handler exactly once", () => {
    const result = runRule(
      rnListCallbackPerRow,
      `const C = () => (
  <FlatList
    renderItem={({item}) => (
      <FlatList
        data={item.sub}
        renderItem={({item: sub}) => (<Sub onPress={() => pick(sub)} />)}
      />
    )}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline handler inside a nested renderItem wrapped in useCallback", () => {
    const result = runRule(
      rnListCallbackPerRow,
      `const C = () => (
  <FlatList
    renderItem={({item}) => (
      <FlatList
        data={item.sub}
        renderItem={useCallback(({item: sub}) => (<Sub onPress={() => pick(sub)} />), [])}
      />
    )}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline handler inside a nested renderItem behind a conditional", () => {
    const result = runRule(
      rnListCallbackPerRow,
      `const C = () => (
  <FlatList
    renderItem={({item}) => (
      <FlatList
        data={item.sub}
        renderItem={item.big ? renderBigRow : ({item: sub}) => (<Sub onPress={() => pick(sub)} />)}
      />
    )}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a single inline handler in a non-nested renderItem", () => {
    const result = runRule(
      rnListCallbackPerRow,
      `const C = () => (
  <FlatList renderItem={({item}) => (<Row onPress={() => pick(item)} />)} />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
