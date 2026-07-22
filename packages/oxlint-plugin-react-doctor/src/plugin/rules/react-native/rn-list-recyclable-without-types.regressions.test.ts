import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnListRecyclableWithoutTypes } from "./rn-list-recyclable-without-types.js";

describe("react-native/rn-list-recyclable-without-types — regressions", () => {
  it("stays silent on a name-only match against a local component", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `const FlashList = MyOwnList;
const C = () => (<FlashList recycleItems data={items} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an imported FlashList without getItemType", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (<FlashList recycleItems data={items} renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags <FL.FlashList> on a flash-list namespace import", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import * as FL from "@shopify/flash-list";
const C = () => (<FL.FlashList recycleItems data={items} renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an aliased FlashList import without getItemType", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList as List } from "@shopify/flash-list";
const C = () => (<List recycleItems data={items} renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a member FlashList from a non-owner namespace import", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import * as FL from "./my-lists";
const C = () => (<FL.FlashList recycleItems data={items} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a heterogeneous FlashList v2 without an explicit recycleItems prop", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderItem = ({ item }) => {
  if (item.kind === "header") return <Header />;
  return <Row />;
};
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    `(item.kind === "header" && <Header />) || <Row />`,
    `(item.kind === "header" ? <Header /> : null) ?? <Row />`,
  ])("flags heterogeneous logical render roots: %s", (renderItemExpression) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (<FlashList data={items} renderItem={({ item }) => ${renderItemExpression}} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a homogeneous FlashList v2", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (<FlashList data={items} renderItem={({ item }) => <Row item={item} />} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when getItemType separates the recycle pools", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (<FlashList data={items} getItemType={item => item.kind} renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
