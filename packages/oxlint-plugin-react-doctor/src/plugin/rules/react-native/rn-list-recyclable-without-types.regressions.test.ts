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
