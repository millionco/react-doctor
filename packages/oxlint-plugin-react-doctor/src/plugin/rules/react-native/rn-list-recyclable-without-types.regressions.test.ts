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
const C = () => (<FlashList recycleItems data={items} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags <FL.FlashList> on a flash-list namespace import", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import * as FL from "@shopify/flash-list";
const C = () => (<FL.FlashList recycleItems data={items} renderItem={r} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an aliased FlashList import without getItemType", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList as List } from "@shopify/flash-list";
const C = () => (<List recycleItems data={items} renderItem={r} />);`,
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
});
