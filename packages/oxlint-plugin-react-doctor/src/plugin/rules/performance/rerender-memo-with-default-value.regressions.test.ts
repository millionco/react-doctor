import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderMemoWithDefaultValue } from "./rerender-memo-with-default-value.js";

describe("performance/rerender-memo-with-default-value — regressions", () => {
  it("flags a defaulted array listed in a useMemo dependency array", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useMemo } from "react";
const Chart = ({ places = [] }) => {
  const placeByKey = useMemo(() => new Map(places.map((place) => [place.key, place])), [places]);
  return <div>{placeByKey.size}</div>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.message).toContain("dependency array");
  });

  it("flags a defaulted array listed in a useCallback dependency array", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useCallback } from "react";
const Tracker = ({ markerCategories = [] }) => {
  const fetchData = useCallback(() => load(markerCategories), [markerCategories]);
  return <button onClick={fetchData}>load</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags a defaulted object passed whole as a prop to an imported component", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import InternalAreaChart from "./internal";
function AreaChart({ i18nStrings = {}, ...props }) {
  return <InternalAreaChart i18nStrings={i18nStrings} {...props} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]?.message).toContain("redrawing children");
  });

  it("flags a defaulted array passed as a prop to a same-file memo component", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <ul>{items.length}</ul>);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when the defaulted object is only destructured locally", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `export function AppLayoutToolbar({ toolbarProps = {} }) {
  const { ariaLabels, drawers, onActiveDrawerChange } = toolbarProps;
  return <div aria-label={ariaLabels}>{drawers.length}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted object is only read via member access", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const AutosuggestOption = ({ nativeAttributes = {}, option }) => {
  const a11yProperties = {};
  if (nativeAttributes["aria-label"]) {
    a11yProperties["aria-label"] = nativeAttributes["aria-label"];
  }
  return <div {...a11yProperties}>{option.label}</div>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted object is only spread into an inline style", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `export function DropCardIndicator({ edge, style = {} }) {
  if (!edge) return null;
  return <div style={{ position: "absolute", ...style }} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted array is only mapped into plain children", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const Menu = ({ items = [] }) => (
  <ul>
    {items.map((innerItem) => (
      <li key={innerItem.id}>{innerItem.label}</li>
    ))}
  </ul>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted object is only passed as a function argument", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const InternalBox = ({ margin = {} }) => {
  const marginClassNames = getClassNamesSuffixes(margin);
  return <div className={marginClassNames.join(" ")} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted binding is passed to a same-file plain (non-memo) component", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const SponsorsWall = ({ sponsors }) => <ul>{sponsors.length}</ul>;
const PricingSection = ({ sponsors = [] }) => <SponsorsWall sponsors={sponsors} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted binding is passed to an intrinsic element", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const Styled = ({ style = {} }) => <div style={style} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an inner destructuring default that binds no object", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const Fallback = ({ i18nStrings: { descriptionText, feedbackText } = {} }) => (
  <p>
    {descriptionText} {feedbackText}
  </p>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the defaulted binding never lands in deps arrays", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useEffect, useState } from "react";
const StageHistoryModal = ({ runHistory = [], open }) => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    setRows(runHistory.slice(0, 10));
  }, [open]);
  return <table>{rows.length}</table>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats a shadowed name inside a nested callback as a different variable", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoRow = memo(({ items }) => <li>{items.length}</li>);
const List = ({ items = [], groups }) => (
  <ul>
    {groups.map((items) => (
      <MemoRow key={items.id} items={items} />
    ))}
  </ul>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a use inside a nested callback when the name is not shadowed", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoRow = memo(({ items }) => <li>{items.length}</li>);
const List = ({ items = [], groups }) => (
  <ul>
    {groups.map((group) => (
      <MemoRow key={group.id} items={items} />
    ))}
  </ul>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags a defaulted object with a non-empty default only when it is empty", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import Child from "./child";
const Panel = ({ config = { mode: "grid" } }) => <Child config={config} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
