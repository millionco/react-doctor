import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnListDataMapped } from "./rn-list-data-mapped.js";

describe("react-native/rn-list-data-mapped — regressions", () => {
  it("stays silent on an empty-array placeholder", () => {
    const result = runRule(
      rnListDataMapped,
      `const C = () => <FlatList data={[]} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a freshly mapped array", () => {
    const result = runRule(
      rnListDataMapped,
      `const C = ({ items }) => <FlatList data={items.map((x) => x.id)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the list name is a rebound local component", () => {
    const result = runRule(
      rnListDataMapped,
      `const FlatList = MyTable;
const C = ({ items }) => (<FlatList data={items.map((x) => x.v)} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a FlatList imported from react-native", () => {
    const result = runRule(
      rnListDataMapped,
      `import { FlatList } from "react-native";
const C = ({ items }) => (<FlatList data={items.map((x) => x.v)} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an aliased recycler import from its owning package", () => {
    const result = runRule(
      rnListDataMapped,
      `import { FlashList as FL } from "@shopify/flash-list";
const C = ({ items }) => (<FL data={items.map((x) => x.v)} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on an aliased local that is not the recycler", () => {
    const result = runRule(
      rnListDataMapped,
      `import { FlashList as FL } from "./my-flash-list";
const C = ({ items }) => (<FL data={items.map((x) => x.v)} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a FlatList imported from react-native-gesture-handler", () => {
    const result = runRule(
      rnListDataMapped,
      `import { FlatList } from "react-native-gesture-handler";
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('flags a FlatList destructured from require("react-native")', () => {
    const result = runRule(
      rnListDataMapped,
      `const { FlatList } = require("react-native");
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a FlatList destructured from a non-RN require", () => {
    const result = runRule(
      rnListDataMapped,
      `const { FlatList } = require("./design-system");
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a FlatList destructured from a react-native namespace import", () => {
    const result = runRule(
      rnListDataMapped,
      `import * as RN from "react-native";
const { FlatList } = RN;
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a FlatList member-aliased from a react-native namespace import", () => {
    const result = runRule(
      rnListDataMapped,
      `import * as RN from "react-native";
const FlatList = RN.FlatList;
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a FlatList member-aliased from an unrelated namespace import", () => {
    const result = runRule(
      rnListDataMapped,
      `import * as Styled from "./design-system";
const FlatList = Styled.FlatList;
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the list name is aliased to a local component", () => {
    const result = runRule(
      rnListDataMapped,
      `const FlatList = MyFlatList;
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an aliased built-in list import (`import { FlatList as List }`)", () => {
    const result = runRule(
      rnListDataMapped,
      `import { FlatList as List } from "react-native";
const C = ({ items }) => <List data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a same-named import from an unrelated package", () => {
    const result = runRule(
      rnListDataMapped,
      `import { FlatList } from "some-ui-kit";
const C = ({ items }) => <FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags <Animated.FlatList> with no local Animated binding", () => {
    const result = runRule(
      rnListDataMapped,
      `const C = ({ items }) => <Animated.FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags <Animated.FlatList> when Animated comes from react-native", () => {
    const result = runRule(
      rnListDataMapped,
      `import { Animated } from "react-native";
const C = ({ items }) => <Animated.FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags <RN.FlatList> on a react-native namespace import", () => {
    const result = runRule(
      rnListDataMapped,
      `import * as RN from "react-native";
const C = ({ items }) => <RN.FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a member list from an unrelated namespace import", () => {
    const result = runRule(
      rnListDataMapped,
      `import * as Styled from "./design-system";
const C = ({ items }) => <Styled.FlatList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags <FL.FlashList> on a flash-list namespace import", () => {
    const result = runRule(
      rnListDataMapped,
      `import * as FL from "@shopify/flash-list";
const C = ({ items }) => <FL.FlashList data={items.map((x) => x.v)} renderItem={r} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
