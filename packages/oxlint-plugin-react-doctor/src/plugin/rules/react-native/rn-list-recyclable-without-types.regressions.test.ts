import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnListRecyclableWithoutTypes } from "./rn-list-recyclable-without-types.js";

const LOGICAL_CHAIN_LENGTH = 24;

describe("react-native/rn-list-recyclable-without-types — regressions", () => {
  it("recommends a data-shape-agnostic getItemType", () => {
    expect(rnListRecyclableWithoutTypes.recommendation).toContain(
      "returns a stable type for each row shape",
    );
    expect(rnListRecyclableWithoutTypes.recommendation).not.toContain("item.kind");
  });

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

  it.each([
    {
      componentName: "LegendList",
      importStatement: `import { LegendList } from "@legendapp/list/react-native";`,
      settings: undefined,
    },
    {
      componentName: "AnimatedLegendList",
      importStatement: `import { AnimatedLegendList } from "@legendapp/list/animated";`,
      settings: undefined,
    },
    {
      componentName: "AnimatedLegendList",
      importStatement: `import { AnimatedLegendList } from "@legendapp/list/reanimated";`,
      settings: undefined,
    },
    {
      componentName: "KeyboardAwareLegendList",
      importStatement: `import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";`,
      settings: undefined,
    },
    {
      componentName: "KeyboardAvoidingLegendList",
      importStatement: `import { KeyboardAvoidingLegendList } from "@legendapp/list/keyboard-legacy";`,
      settings: undefined,
    },
    {
      componentName: "AnimatedFlashList",
      importStatement: `import { AnimatedFlashList } from "@shopify/flash-list";`,
      settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } },
    },
  ])(
    "flags heterogeneous $componentName rows from its canonical entrypoint",
    ({ componentName, importStatement, settings }) => {
      const recycleItemsProp = componentName === "AnimatedFlashList" ? "" : " recycleItems";
      const result = runRule(
        rnListRecyclableWithoutTypes,
        `${importStatement}
const C = () => (
  <${componentName}${recycleItemsProp}
    data={items}
    renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
  />
);`,
        settings ? { settings } : undefined,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("resolves an aliased AnimatedLegendList export", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { AnimatedLegendList as ReanimatedLegendList } from "@legendapp/list/reanimated";
const C = () => (
  <ReanimatedLegendList
    recycleItems
    data={items}
    renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves the Legend List v3 namespace entrypoint", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import * as Lists from "@legendapp/list/react-native";
const C = () => (
  <Lists.LegendList
    recycleItems
    data={items}
    renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `import { SectionList } from "@legendapp/list/section-list";
const C = () => (
  <SectionList
    recycleItems
    sections={sections}
    renderSectionHeader={({ section }) => <Header section={section} />}
    renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
  />
);`,
    `import { LegendList } from "@legendapp/list/react";
const C = () => (
  <LegendList
    recycleItems
    data={items}
    renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
  />
);`,
  ])("stays silent for a non-target Legend renderer", (code) => {
    const result = runRule(rnListRecyclableWithoutTypes, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the JSX binding when an imported recycler name is shadowed", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { LegendList } from "@legendapp/list/react-native";
const C = () => {
  const LegendList = LocalList;
  return (
    <LegendList
      recycleItems
      data={items}
      renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
    />
  );
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the JSX binding when an imported recycler namespace is shadowed", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import * as Lists from "@legendapp/list/react-native";
const C = () => {
  const Lists = LocalLists;
  return (
    <Lists.LegendList
      recycleItems
      data={items}
      renderItem={({ item }) => item.kind === "header" ? <Header /> : <Row />}
    />
  );
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  it("flags a heterogeneous named function declaration", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function renderItem({ item }) {
  if (item.kind === "header") return <Header />;
  return <Row />;
}
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a const alias of a heterogeneous function declaration", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function renderRow({ item }) {
  return item.kind === "header" ? <Header /> : <Row />;
}
const renderItem = renderRow;
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a homogeneous function declaration", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function renderItem({ item }) {
  return <Row item={item} />;
}
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a reassigned function declaration", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function renderItem({ item }) {
  return item.kind === "header" ? <Header /> : <Row />;
}
renderItem = ({ item }) => <Row item={item} />;
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["let", "var"])(
    "stays silent when a %s renderItem changes from heterogeneous to homogeneous",
    (declarationKind) => {
      const result = runRule(
        rnListRecyclableWithoutTypes,
        `import { FlashList } from "@shopify/flash-list";
${declarationKind} renderItem = ({ item }) =>
  item.kind === "header" ? <Header /> : <Row />;
renderItem = ({ item }) => <Row item={item} />;
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
        { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["let", "var"])(
    "stays silent when a %s renderItem changes from homogeneous to heterogeneous",
    (declarationKind) => {
      const result = runRule(
        rnListRecyclableWithoutTypes,
        `import { FlashList } from "@shopify/flash-list";
${declarationKind} renderItem = ({ item }) => <Row item={item} />;
renderItem = ({ item }) =>
  item.kind === "header" ? <Header /> : <Row />;
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
        { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("uses the nearest shadowed function declaration", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function renderItem({ item }) {
  return item.kind === "header" ? <Header /> : <Row />;
}
const C = () => {
  function renderItem({ item }) {
    return <Row item={item} />;
  }
  return <FlashList data={items} renderItem={renderItem} />;
};`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an imported renderItem handler", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
import { renderItem } from "./render-item";
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a one-hop local row component selected by the forwarded item", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { LegendList } from "@legendapp/list/react-native";
const ListItem = ({ item }) => {
  if (item.isHeader) return <HeaderItem title={item.text} />;
  if (item.imageUrl) return <ImageItem url={item.imageUrl} />;
  return <MessageItem text={item.text} />;
};
const C = () => (
  <LegendList
    recycleItems
    data={items}
    renderItem={({ item }) => <ListItem item={item} />}
  />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a local row component through renamed props and bindings", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function ListItem({ row: model }) {
  return model.kind === "header" ? <HeaderItem /> : <MessageItem />;
}
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => <ListItem row={item} />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a local row component wrapped in proven React HOCs", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import React, { forwardRef as withRef, memo as withMemo } from "react";
import { FlashList } from "@shopify/flash-list";
const ListItem = withMemo(withRef(({ item }, ref) =>
  item.kind === "header" ? <HeaderItem ref={ref} /> : <MessageItem ref={ref} />
));
const C = () => (
  <FlashList data={items} renderItem={({ item }) => <ListItem item={item} />} />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const ListItem = ({ item, variant }) =>
  variant === "header" ? <HeaderItem item={item} /> : <MessageItem item={item} />;`,
    `import { ListItem } from "./list-item";`,
    `const withTheme = (component) => component;
const ListItem = withTheme(({ item }) =>
  item.kind === "header" ? <HeaderItem /> : <MessageItem />
);`,
    `const memo = (component) => component;
const ListItem = memo(({ item }) =>
  item.kind === "header" ? <HeaderItem /> : <MessageItem />
);`,
  ])("keeps an unproven local row component opaque", (listItemDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
${listItemDeclaration}
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => <ListItem item={item} variant="row" />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a later spread can replace the forwarded item prop", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const ListItem = ({ item }) =>
  item.kind === "header" ? <HeaderItem /> : <MessageItem />;
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => <ListItem item={item} {...overrides} />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an exact same-file renderer helper called with the item", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderRow = (item) =>
  item.kind === "header" ? <HeaderItem /> : <MessageItem />;
const C = () => (
  <FlashList data={items} renderItem={({ item }) => renderRow(item)} />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a helper that destructures forwarded render information", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
function renderRow({ item }) {
  return item.kind === "header" ? <HeaderItem /> : <MessageItem />;
}
const C = () => (
  <FlashList data={items} renderItem={(info) => renderRow(info)} />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const renderRow = (item) =>
  item.kind === "header" ? <HeaderItem /> : <MessageItem />;`,
    `import { renderRow } from "./render-row";`,
  ])(
    "keeps a renderer helper opaque when the row item does not flow into it",
    (helperDeclaration) => {
      const result = runRule(
        rnListRecyclableWithoutTypes,
        `import { FlashList } from "@shopify/flash-list";
${helperDeclaration}
const C = () => (
  <FlashList data={items} renderItem={() => renderRow(fixedItem)} />
);`,
        { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("flags an item-selected local component alias", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = item.kind === "header" ? HeaderItem : MessageItem;
      return <ListItem item={item} />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a returned JSX value alias selected by the item", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const renderedRow = item.kind === "header" ? <HeaderItem /> : <MessageItem />;
      return renderedRow;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a whole-list component selection opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = ({ compact }) => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = compact ? CompactItem : DetailedItem;
      return <ListItem item={item} />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `if (!item) return null;
  return variant === "header" ? <HeaderItem /> : <MessageItem />;`,
    `if (item.isHeader) return <HeaderItem />;
  return variant === "message" ? <MessageItem /> : <ImageItem />;`,
  ])("keeps mixed item and ambient root selection opaque", (rendererBody) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const ListItem = ({ item, variant }) => {
  ${rendererBody}
};
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => <ListItem item={item} variant="message" />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an ambient direct renderer selection opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = ({ compact }) => (
  <FlashList
    data={items}
    renderItem={({ item }) => compact ? <CompactItem item={item} /> : <DetailedItem item={item} />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `function ListItem({ item }) {
  return item.kind === "header" ? <HeaderItem /> : <MessageItem />;
}
const renderItem = ({ item }) => <ListItem item={item} />;
ListItem = () => <MessageItem />;`,
    `function renderRow(item) {
  return item.kind === "header" ? <HeaderItem /> : <MessageItem />;
}
const renderItem = ({ item }) => renderRow(item);
renderRow = () => <MessageItem />;`,
  ])("keeps a renderer reassigned after list creation opaque", (rendererDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
${rendererDeclaration}
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `const renderItem = ({ item }) => {
  item = fixedItem;
  return item.kind === "header" ? <HeaderItem /> : <MessageItem />;
};`,
    `const ListItem = ({ item }) => {
  item = fixedItem;
  return item.kind === "header" ? <HeaderItem /> : <MessageItem />;
};
const renderItem = ({ item }) => <ListItem item={item} />;`,
  ])("keeps a reassigned forwarded item binding opaque", (rendererDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
${rendererDeclaration}
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("collapses duplicate import aliases of the same component", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
import { Row as HeaderAlias } from "./row";
import { Row as MessageAlias } from "./row";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = item.kind === "header" ? HeaderAlias : MessageAlias;
      return <ListItem />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("collapses stable aliases of the same imported member", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
import * as Cells from "./cells";
const HeaderAlias = Cells.Row;
const MessageAlias = Cells.Row;
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = item.kind === "header" ? HeaderAlias : MessageAlias;
      return <ListItem />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("collapses named and namespace references to the same imported component", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
import { Row } from "./cells";
import * as Cells from "./cells";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.kind === "header" ? <Row /> : <Cells.Row />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("distinguishes destructured imported component bindings", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
import * as Cells from "./cells";
const { HeaderItem, MessageItem } = Cells;
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) =>
      item.kind === "header" ? <HeaderItem /> : <MessageItem />
    }
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("collapses destructured aliases of the same imported component", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
import * as Cells from "./cells";
const { Row: HeaderAlias, Row: MessageAlias } = Cells;
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) =>
      item.kind === "header" ? <HeaderAlias /> : <MessageAlias />
    }
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `const HeaderAlias = getCell();
const MessageAlias = getCell();`,
    `const HeaderAlias = dark ? SharedItem : SharedItem;
const MessageAlias = dark ? SharedItem : SharedItem;`,
  ])("keeps unresolved component aliases opaque", (aliasDeclarations) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
${aliasDeclarations}
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = item.kind === "header" ? HeaderAlias : MessageAlias;
      return <ListItem />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("distinguishes shadowed local component bindings by symbol", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      if (item.kind === "header") {
        const ListItem = HeaderItem;
        return <ListItem />;
      }
      {
        const ListItem = MessageItem;
        return <ListItem />;
      }
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not count a repeated expanded component as a second root", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const ListItem = ({ item }) =>
  item.kind === "header" ? <SharedItem /> : <SharedItem />;
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) =>
      item.featured ? <ListItem item={item} /> : <ListItem item={item} />
    }
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags item-selected components wrapped in proven React HOCs", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { memo } from "react";
import { FlashList } from "@shopify/flash-list";
const HeaderItem = memo(() => <Header />);
const MessageItem = memo(() => <Message />);
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) =>
      item.kind === "header" ? <HeaderItem /> : <MessageItem />
    }
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags proven React HOCs wrapping imported components", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { memo } from "react";
import { FlashList } from "@shopify/flash-list";
import { Header, Message } from "./items";
const HeaderItem = memo(Header);
const MessageItem = memo(Message);
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) =>
      item.kind === "header" ? <HeaderItem /> : <MessageItem />
    }
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `return item.kind === "header"
  ? <HeaderItem style={dark && styles.dark} />
  : <MessageItem />;`,
    `const color = dark ? "black" : "white";
return item.kind === "header" ? <HeaderItem color={color} /> : <MessageItem />;`,
  ])("ignores ambient selections that do not choose a rendered root", (rendererBody) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderItem = ({ item }) => {
  ${rendererBody}
};
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps mutable component aliases opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const SharedItem = () => <Row />;
let HeaderAlias = SharedItem;
let MessageAlias = SharedItem;
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = item.kind === "header" ? HeaderAlias : MessageAlias;
      return <ListItem />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `const SharedItem = () => <Row />;
const cells = { HeaderItem: SharedItem, MessageItem: SharedItem };`,
    `let cells = { HeaderItem, MessageItem };`,
  ])("keeps local component registries opaque", (registryDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
${registryDeclaration}
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      const ListItem = item.kind === "header" ? cells.HeaderItem : cells.MessageItem;
      return <ListItem />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `import React, { Fragment } from "react";
const renderItem = ({ item }) => item.kind === "header"
  ? React.createElement(Fragment, null, React.createElement(HeaderItem))
  : React.createElement(MessageItem);`,
    `import React from "react";
const renderItem = ({ item }) => item.kind === "header"
  ? React.createElement(React.Fragment, null, React.createElement(HeaderItem))
  : React.createElement(MessageItem);`,
  ])("keeps createElement fragment roots opaque", (rendererDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `${rendererDeclaration}
import { FlashList } from "@shopify/flash-list";
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a stable React.Fragment alias opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import React from "react";
import { FlashList } from "@shopify/flash-list";
const FragmentAlias = React.Fragment;
const renderItem = ({ item }) => item.kind === "header"
  ? React.createElement(FragmentAlias, null, React.createElement(HeaderItem))
  : React.createElement(HeaderItem);
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a destructured React.Fragment alias opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import React from "react";
import { FlashList } from "@shopify/flash-list";
const { Fragment: FragmentAlias } = React;
const renderItem = ({ item }) => item.kind === "header"
  ? React.createElement(FragmentAlias, null, React.createElement(HeaderItem))
  : React.createElement(HeaderItem);
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `const renderRow = (item) =>
  React.createElement(item.kind === "header" ? HeaderItem : MessageItem);
const renderItem = ({ item }) => renderRow(item);`,
    `const ListItem = ({ item }) =>
  React.createElement(item.kind === "header" ? HeaderItem : MessageItem);
const renderItem = ({ item }) => <ListItem item={item} />;`,
  ])("follows an item-selected createElement type through one hop", (rendererDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import React from "react";
import { FlashList } from "@shopify/flash-list";
${rendererDeclaration}
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `try {
  return <HeaderItem />;
} catch {
  return <MessageItem />;
}`,
    `for (const entry of entries) {
  return <HeaderItem entry={entry} />;
}
return <MessageItem />;`,
  ])("keeps ambient control-flow roots opaque", (rendererBody) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderItem = ({ item }) => {
  ${rendererBody}
};
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `<FlashList
  data={items}
  renderItem={({ item }) => item.kind === "header" ? <HeaderItem /> : <MessageItem />}
  {...props}
/>`,
    `<FlashList
  data={items}
  renderItem={({ item }) => item.kind === "header" ? <HeaderItem /> : <MessageItem />}
  {...{ getItemType: (item) => item.kind }}
/>`,
  ])("keeps list props that a later spread can replace opaque", (listElement) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (${listElement});`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("respects recycleItems disabled by a later static spread", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    recycleItems
    {...{ recycleItems: false }}
    data={items}
    renderItem={({ item }) => item.kind === "header" ? <HeaderItem /> : <MessageItem />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unreachable sibling returns without item-dependent control flow", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderItem = () => {
  return <HeaderItem />;
  return <MessageItem />;
};
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores an unreachable root after item-dependent returns", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderItem = ({ item }) => {
  if (item.kind === "header") return <SharedItem />;
  return <SharedItem />;
  return <UnreachableItem />;
};
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `if (item.kind === "header") return <SharedItem />;
  else return <SharedItem />;
  return <UnreachableItem />;`,
    `switch (item.kind) {
    case "header":
      return <SharedItem />;
    default:
      return <SharedItem />;
  }
  return <UnreachableItem />;`,
  ])("ignores roots after an exhaustive terminal branch", (rendererBody) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const renderItem = ({ item }) => {
  ${rendererBody}
};
const C = () => <FlashList data={items} renderItem={renderItem} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores item reads discarded by a sequence selector", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => (item.kind, false) ? <HeaderItem /> : <MessageItem />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `item.kind && false ? <HeaderItem /> : <MessageItem />`,
    `item.kind || true ? <HeaderItem /> : <MessageItem />`,
  ])("ignores roots behind a statically fixed compound selector", (renderItemExpression) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList data={items} renderItem={({ item }) => ${renderItemExpression}} />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `const componentByKind = { header: HeaderItem, message: MessageItem };
const ListItem = componentByKind[item.kind];`,
    `const SharedItem = ({ item }) => <Row item={item} />;
const HeaderAlias = SharedItem;
const MessageAlias = SharedItem;
const ListItem = item.kind === "header" ? HeaderAlias : MessageAlias;`,
  ])("stays silent when an item-selected alias does not prove distinct roots", (selection) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => {
      ${selection}
      return <ListItem item={item} />;
    }}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `import React from "react";
const renderRow = ({ item }) => item.kind === "header"
  ? React.createElement(HeaderItem)
  : React.createElement(MessageItem);`,
    `import { createElement as h } from "react";
const renderRow = ({ item }) => item.kind === "header"
  ? h(HeaderItem)
  : h(MessageItem);`,
  ])(
    "flags heterogeneous roots created with a proven React createElement",
    (rendererDeclaration) => {
      const result = runRule(
        rnListRecyclableWithoutTypes,
        `${rendererDeclaration}
import { FlashList } from "@shopify/flash-list";
const C = () => <FlashList data={items} renderItem={renderRow} />;`,
        { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    `const createElement = (component) => component;
const renderRow = ({ item }) => item.kind === "header"
  ? createElement(HeaderItem)
  : createElement(MessageItem);`,
    `const renderRow = ({ item }) => item.kind === "header"
  ? document.createElement("header")
  : document.createElement("article");`,
  ])("keeps non-React createElement calls opaque", (rendererDeclaration) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `${rendererDeclaration}
import { FlashList } from "@shopify/flash-list";
const C = () => <FlashList data={items} renderItem={renderRow} />;`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `(item.kind === "header" && <Header />) || <Row />`,
    `(item.kind === "header" ? <Header /> : null) ?? <Row />`,
    `(null, item.kind === "header" ? <Header /> : <Row />)`,
    `item.kind === "header" ? (null, <Header />) : <Row />`,
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

  it.each([
    `<Header /> && <Row />`,
    `<Header /> || <Row />`,
    `<Header /> ?? <Row />`,
    `condition && <Header /> && <Row />`,
    `condition || <Header /> || <Row />`,
    `condition ?? <Header /> ?? <Row />`,
    `condition || (<Header /> && <Row />)`,
    `(condition ? <Header /> : <Row />, <Row />)`,
  ])("stays silent when a logical expression returns one static JSX root: %s", (expression) => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (<FlashList data={items} renderItem={() => (${expression})} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps chained conditional logical analysis bounded", () => {
    const chainedExpression = Array.from(
      { length: LOGICAL_CHAIN_LENGTH },
      (_, operandIndex) => `(conditions[${operandIndex}] ? <Row /> : <Row />)`,
    ).join(" && ");
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList data={items} renderItem={() => (${chainedExpression})} />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a fragment root mixed with an element root", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.kind === "header"
      ? <><Header /><Metadata /></>
      : <Row />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags differently shaped fragment-only roots", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.kind === "header"
      ? <><Header /><Metadata /></>
      : <><Row /></>}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for one stable multi-child fragment root", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList data={items} renderItem={() => <><Row /><Metadata /></>} />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats a one-child fragment like its rendered element root", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.active ? <><Row /></> : <Row />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats whitespace, comments, and nested fragments as shape-transparent", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.active
      ? <><Row />{/* stable */}<><Metadata /></></>
      : <><Row /><Metadata /></>}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a fragment shape contains dynamic children", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.active ? <>{item.content}</> : <Row />}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags differently shaped named React Fragment roots", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { Fragment as ReactFragment } from "react";
import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.active
      ? <ReactFragment><Header /><Metadata /></ReactFragment>
      : <ReactFragment><Row /></ReactFragment>}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      reactImport: `import { Fragment } from "react";`,
      openingFragment: "<Fragment>",
      closingFragment: "</Fragment>",
    },
    {
      reactImport: `import React from "react";`,
      openingFragment: "<React.Fragment>",
      closingFragment: "</React.Fragment>",
    },
    {
      reactImport: `import * as ReactNamespace from "react";`,
      openingFragment: "<ReactNamespace.Fragment>",
      closingFragment: "</ReactNamespace.Fragment>",
    },
  ])(
    "treats $openingFragment like shorthand fragment syntax",
    ({ reactImport, openingFragment, closingFragment }) => {
      const result = runRule(
        rnListRecyclableWithoutTypes,
        `${reactImport}
import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.active
      ? ${openingFragment}<Row /><Metadata />${closingFragment}
      : <><Row /><Metadata /></>}
  />
);`,
        { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("keeps a locally shadowed Fragment component opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { Fragment } from "react";
import { FlashList } from "@shopify/flash-list";
const C = () => {
  const Fragment = ({ children }) => <View>{children}</View>;
  return (
    <FlashList
      data={items}
      renderItem={({ item }) => item.active
        ? <Fragment><Header /></Fragment>
        : <Fragment><Row /></Fragment>}
    />
  );
};`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a non-React Fragment import opaque", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { Fragment } from "./ui";
import { FlashList } from "@shopify/flash-list";
const C = () => (
  <FlashList
    data={items}
    renderItem={({ item }) => item.active
      ? <Fragment><Header /></Fragment>
      : <Fragment><Row /></Fragment>}
  />
);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a heterogeneous renderItem wrapped in React useCallback", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { useCallback } from "react";
import { FlashList } from "@shopify/flash-list";
const C = () => {
  const renderItem = useCallback(
    ({ item }) => item.kind === "header" ? <Header /> : <Row />,
    [],
  );
  return <FlashList data={items} renderItem={renderItem} />;
};`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a locally shadowed useCallback wrapper", () => {
    const result = runRule(
      rnListRecyclableWithoutTypes,
      `import { FlashList } from "@shopify/flash-list";
const useCallback = (callback) => ({ callback });
const renderItem = useCallback(({ item }) => item.kind === "header" ? <Header /> : <Row />);
const C = () => (<FlashList data={items} renderItem={renderItem} />);`,
      { settings: { "react-doctor": { shopifyFlashListMajorVersion: 2 } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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
