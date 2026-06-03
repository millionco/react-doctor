import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnListMissingEstimatedItemSize } from "./rn-list-missing-estimated-item-size.js";

describe("rn-list-missing-estimated-item-size", () => {
  it("flags FlashList from @shopify/flash-list without estimatedItemSize", () => {
    const code = `
      import { FlashList } from "@shopify/flash-list";
      const Screen = ({ items }) => (
        <FlashList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("estimatedItemSize");
  });

  it("does NOT flag FlashList v2 without estimatedItemSize", () => {
    const code = `
      import { FlashList } from "@shopify/flash-list";
      const Screen = ({ items }) => (
        <FlashList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code, {
      settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } },
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags LegendList from @legendapp/list without estimatedItemSize", () => {
    const code = `
      import { LegendList } from "@legendapp/list";
      const Screen = ({ items }) => (
        <LegendList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags genuinely-aliased import `FlashList as List`", () => {
    // The detector must resolve the LOCAL JSX name back to its
    // originally-exported symbol — aliased local bindings (where the
    // JSX element name no longer matches "FlashList") still need to
    // fire. Bugbot caught a prior false confidence here.
    const code = `
      import { FlashList as List } from "@shopify/flash-list";
      const Screen = ({ items }) => (
        <List data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(1);
    // Message names the local JSX element name and the missing prop hint.
    expect(result.diagnostics[0].message).toContain("List");
    expect(result.diagnostics[0].message).toContain("estimatedItemSize");
  });

  it("flags genuinely-aliased import `LegendList as VList`", () => {
    const code = `
      import { LegendList as VList } from "@legendapp/list";
      const Screen = ({ items }) => (
        <VList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag FlashList with estimatedItemSize", () => {
    const code = `
      import { FlashList } from "@shopify/flash-list";
      const Screen = ({ items }) => (
        <FlashList data={items} renderItem={renderItem} estimatedItemSize={64} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag LegendList with estimatedListSize (richer hint)", () => {
    const code = `
      import { LegendList } from "@legendapp/list";
      const Screen = ({ items }) => (
        <LegendList
          data={items}
          renderItem={renderItem}
          estimatedListSize={{ height: 800, width: 360 }}
        />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag FlashList with empty-array data literal", () => {
    const code = `
      import { FlashList } from "@shopify/flash-list";
      const Screen = () => (
        <FlashList data={[]} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag FlashList without any data prop (abstract wrapper)", () => {
    const code = `
      import { FlashList } from "@shopify/flash-list";
      const Wrapper = (props) => <FlashList {...props} />;
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag FlashList from a wrapper / non-Shopify package", () => {
    const code = `
      import { FlashList } from "./my-flash-list-wrapper";
      const Screen = ({ items }) => (
        <FlashList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a local component named FlashList (no import)", () => {
    const code = `
      const FlashList = () => null;
      const Screen = ({ items }) => (
        <FlashList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag FlatList (out of scope, has built-in defaults)", () => {
    const code = `
      const Screen = ({ items }) => (
        <FlatList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag SectionList (out of scope)", () => {
    const code = `
      const Screen = ({ sections }) => (
        <SectionList sections={sections} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag namespaced <Shopify.FlashList> (no top-level import to verify)", () => {
    // After the import-scope tightening, namespaced JSX still resolves
    // to the trailing identifier "FlashList" via resolveJsxElementName
    // — but there's no local binding named "FlashList" to verify
    // against, so the rule stays quiet. Tradeoff: <Shopify.FlashList>
    // false negatives, in exchange for zero noise on wrapper components.
    const code = `
      import * as Shopify from "@shopify/flash-list";
      const Screen = ({ items }) => (
        <Shopify.FlashList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inside testlike file (tags: test-noise)", () => {
    const code = `
      import { FlashList } from "@shopify/flash-list";
      const Screen = ({ items }) => (
        <FlashList data={items} renderItem={renderItem} />
      );
    `;
    const result = runRule(rnListMissingEstimatedItemSize, code, {
      filename: "Screen.test.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
