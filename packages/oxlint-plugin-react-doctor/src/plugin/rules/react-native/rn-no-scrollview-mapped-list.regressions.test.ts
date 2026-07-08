import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoScrollviewMappedList } from "./rn-no-scrollview-mapped-list.js";

describe("react-native/rn-no-scrollview-mapped-list — regressions", () => {
  it("stays silent on a short array literal", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = () => (
  <ScrollView>
    {[0, 1].map((columnIndex) => <Column key={columnIndex} />)}
  </ScrollView>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a fixed-size Array(n).fill skeleton", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = () => (
  <ScrollView>
    {Array(5)
      .fill(null)
      .map((_, i) => <Skeleton key={i} />)}
  </ScrollView>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a const bound to a conditional between short module arrays", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const ALL_CATEGORIES = [
  { label: "All", value: "all" },
  { label: "Favorites", value: "favorites" },
  { label: "Reposts", value: "reposts" },
  { label: "Premium", value: "premium" },
];
const CATEGORIES_WITHOUT_PURCHASED = ALL_CATEGORIES.slice(0, -1);
const C = ({ showPurchased }) => {
  const categories = showPurchased ? ALL_CATEGORIES : CATEGORIES_WITHOUT_PURCHASED;
  return (
    <ScrollView horizontal>
      {categories.map((category) => <Pill key={category.value} label={category.label} />)}
    </ScrollView>
  );
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags mapping an unbounded data array", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = ({ tracks }) => (
  <ScrollView>
    {tracks.map((track) => <Row key={track.id} track={track} />)}
  </ScrollView>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a long fixed-size skeleton array", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = () => (
  <ScrollView>
    {Array(30)
      .fill(null)
      .map((_, i) => <Skeleton key={i} />)}
  </ScrollView>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a short array iterated with flatMap", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = ({ groups }) => (
  <ScrollView>
    {[0, 1].flatMap((groupIndex) => groups[groupIndex].items.map((item) => <Row key={item.id} />))}
  </ScrollView>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a let binding whose array literal could be reassigned", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = ({ extra }) => {
  let rows = [1, 2, 3];
  if (extra) rows = extra;
  return <ScrollView>{rows.map((row) => <Row key={row} />)}</ScrollView>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags rows built with reduce instead of map", () => {
    const result = runRule(
      rnNoScrollviewMappedList,
      `const C = ({ items }) => (
  <ScrollView>
    {items.reduce((accumulated, item) => [...accumulated, <Row key={item.id} data={item} />], [])}
  </ScrollView>
);`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
