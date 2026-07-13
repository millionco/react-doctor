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

  it("stays silent when an exact memo comparator value-compares the empty default", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
function sameSuggestions(previous, next) {
  return previous.length === next.length && previous.every((suggestion, index) => suggestion === next[index]);
}
const FollowUpSuggestions = memo(
  ({ suggestions }) => <div>{suggestions.length}</div>,
  (previous, next) =>
    previous.hidden === next.hidden &&
    previous.onSelect === next.onSelect &&
    sameSuggestions(previous.suggestions, next.suggestions),
);
const ignoreSuggestion = () => undefined;
function StableAssistantMessage({ suggestions = [], hidden = false, onSelect = ignoreSuggestion }) {
  return <FollowUpSuggestions suggestions={suggestions} hidden={hidden} onSelect={onSelect} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags when the custom comparator distinguishes fresh empty arrays", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => previous.items === next.items);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags when an opaque imported comparator controls equality", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
import { compareItems } from "./compare-items";
const MemoList = memo(({ items }) => <div>{items.length}</div>, compareItems);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when an inline comparator ignores the empty default prop", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import React from "react";
const MemoList = React.memo(({ items, version }) => <div>{items.length + version}</div>, (previous, next) => previous.version === next.version);
const Panel = ({ items = [], version }) => <MemoList items={items} version={version} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when another prop forces the comparator to rerender", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items, version }) => <div>{items.length + version}</div>, (previous, next) => previous.version !== next.version);
const Panel = ({ items = [], version }) => <MemoList items={items} version={version} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when fresh empty references make the comparator bail out", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => previous.items !== next.items);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a comparator proves two empty object defaults equivalent", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo as reactMemo } from "react";
const MemoPanel = reactMemo(
  ({ options }) => <div>{Object.keys(options).length}</div>,
  (previous, next) =>
    Object.keys(previous.options).length === Object.keys(next.options).length &&
    Object.keys(previous.options).every((key) => previous.options[key] === next.options[key]),
);
const Panel = ({ options = {} }) => <MemoPanel options={options} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags similarly named userland memo functions", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `const memo = (component, comparator) => component;
const MemoList = memo(({ items }) => <div>{items.length}</div>, () => true);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when other props are equal under the comparator contract", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(
  ({ items, version }) => <div>{items.length + version}</div>,
  (previous, next) => previous.version === next.version && previous.items.length === next.items.length,
);
const Panel = ({ items = [], version }) => <MemoList items={items} version={version} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["an OR branch", `previous.version === next.version || previous.items === next.items`],
    ["an AND branch", `previous.version === next.version && previous.items === next.items`],
    [
      "a conditional branch",
      `previous.version === next.version ? previous.items === next.items : true`,
    ],
    ["a negated branch", `!(previous.version !== next.version || previous.items !== next.items)`],
  ])(
    "flags when stabilizing the empty prop changes %s for some other-prop state",
    (_name, comparator) => {
      const result = runRule(
        rerenderMemoWithDefaultValue,
        `import { memo } from "react";
const MemoList = memo(
  ({ items, version }) => <div>{items.length + version}</div>,
  (previous, next) => ${comparator},
);
const Panel = ({ items = [], version }) => <MemoList items={items} version={version} />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBe(1);
    },
  );

  it("stays silent when alternate-prop branches preserve the comparator result", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(
  ({ items, version }) => <div>{items.length + version}</div>,
  (previous, next) =>
    previous.version === next.version
      ? previous.items.length === next.items.length
      : previous.items.every(Boolean) === next.items.every(Boolean),
);
const Panel = ({ items = [], version }) => <MemoList items={items} version={version} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags when different alternate props make comparator behavior unknown", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(
  ({ items, left, right }) => <div>{items.length + left + right}</div>,
  (previous, next) =>
    previous.left === next.right || previous.items.length === next.items.length,
);
const Panel = ({ items = [], left, right }) => (
  <MemoList items={items} left={left} right={right} />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it.each([
    [
      "reversed previous and next operands",
      `next.version === previous.version || previous.items === next.items`,
    ],
    [
      "two independent alternate props",
      `(previous.version === next.version && previous.mode === next.mode) || previous.items === next.items`,
    ],
    [
      "a Boolean equality wrapper",
      `(previous.version === next.version) === (previous.items === next.items)`,
    ],
    [
      "local comparator helpers",
      `same(previous.version, next.version) || same(previous.items, next.items)`,
    ],
  ])("flags target identity hidden behind %s", (_name, comparator) => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const same = (left, right) => left === right;
const MemoList = memo(
  ({ items, mode, version }) => <div>{items.length + mode + version}</div>,
  (previous, next) => ${comparator},
);
const Panel = ({ items = [], mode, version }) => (
  <MemoList items={items} mode={mode} version={version} />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when a comparator compares the same target reference to itself", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(
  ({ items }) => <div>{items.length}</div>,
  (previous, next) => previous.items === previous.items,
);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a comparator that compares two distinct non-target props", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => previous.left === next.right);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when an empty-array index comparison proves equality", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => previous.items[0] === next.items[0]);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when empty-array every and some outcomes prove equality", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(
  ({ items }) => <div>{items.length}</div>,
  (previous, next) => previous.items.every(Boolean) && !next.items.some(Boolean),
);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a local helper with mutation before its result", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
function compareItems(previous, next) {
  previous.push("changed");
  return previous.length === next.length;
}
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => compareItems(previous.items, next.items));
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags side-effecting and throwing comparator bodies", () => {
    const sideEffectResult = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, () => (recordComparison(), true));
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    const throwingResult = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, () => { throw new Error("no"); });
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(sideEffectResult.parseErrors).toEqual([]);
    expect(throwingResult.parseErrors).toEqual([]);
    expect(sideEffectResult.diagnostics.length).toBe(1);
    expect(throwingResult.diagnostics.length).toBe(1);
  });

  it("flags async comparators even when their returned boolean looks safe", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, async (previous, next) => previous.items.length === next.items.length);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags comparators that return a Promise", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, () => Promise.resolve(true));
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags reassigned comparator declarations", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
function compare(previous, next) { return previous.items.length === next.items.length; }
compare = () => false;
const MemoList = memo(({ items }) => <div>{items.length}</div>, compare);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags a JSX component parameter shadowing the proven memo binding", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, () => true);
const Panel = ({ items = [], MemoList }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags a local JSX binding shadowing the proven memo binding", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, () => true);
function Panel({ items = [] }) {
  const MemoList = ({ items: localItems }) => <div>{localItems.length}</div>;
  return <MemoList items={items} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent when empty-object keyed reads prove equality", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoPanel = memo(({ options }) => <div>{String(options.mode)}</div>, (previous, next) => previous.options["mode"] === next.options["mode"]);
const Panel = ({ options = {} }) => <MemoPanel options={options} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when empty-object direct reads prove equality", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoPanel = memo(({ options }) => <div>{String(options.mode)}</div>, (previous, next) => previous.options.mode === next.options.mode);
const Panel = ({ options = {} }) => <MemoPanel options={options} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags empty-array callback methods without a proven callable", () => {
    const missingCallbackResult = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => previous.items.every() === next.items.every());
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    const opaqueCallbackResult = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoList = memo(({ items }) => <div>{items.length}</div>, (previous, next) => previous.items.every(importedCallback) === next.items.every(importedCallback));
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(missingCallbackResult.parseErrors).toEqual([]);
    expect(opaqueCallbackResult.parseErrors).toEqual([]);
    expect(missingCallbackResult.diagnostics.length).toBe(1);
    expect(opaqueCallbackResult.diagnostics.length).toBe(1);
  });

  it("flags inherited empty-object property comparisons", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { memo } from "react";
const MemoPanel = memo(({ options }) => <div>{String(options)}</div>, (previous, next) => previous.options.toString === next.options.toString);
const Panel = ({ options = {} }) => <MemoPanel options={options} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent for a proven namespace-imported React memo comparator", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import * as R from "react";
const compare = (previous, next) => previous.items.length === next.items.length;
const comparatorAlias = compare;
const MemoList = R.memo(({ items }) => <div>{items.length}</div>, comparatorAlias);
const Panel = ({ items = [] }) => <MemoList items={items} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  // FN hunt (semiotic QuadrantChart / ForceDirectedGraph): the component is
  // a forwardRef-wrapped function expression that destructures props IN THE
  // BODY (`const { frameProps = {} } = props`) and lists the defaulted
  // binding in a useMemo dependency array.
  it("flags a body-destructured empty default inside a forwardRef component", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useMemo, forwardRef } from "react";
export const QuadrantChart = forwardRef(function QuadrantChart(props, ref) {
  const { data, centerlineStyle = {}, frameProps = {} } = props;
  const preRenderers = useMemo(() => buildRenderers(centerlineStyle, frameProps), [centerlineStyle, frameProps]);
  return <div>{preRenderers.length}{data.length}</div>;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(2);
    expect(result.diagnostics[0]?.message).toContain("dependency array");
  });

  it("flags a body-destructured empty default in a plain function component", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useMemo } from "react";
function Chart(props) {
  const { rows = [] } = props;
  const total = useMemo(() => rows.length, [rows]);
  return <div>{total}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent for a body destructure of a non-props local object", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `import { useMemo } from "react";
function Chart(props) {
  const config = loadConfig();
  const { rows = [] } = config;
  const total = useMemo(() => rows.length, [rows]);
  return <div>{total}</div>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a body-destructured default that is only used locally", () => {
    const result = runRule(
      rerenderMemoWithDefaultValue,
      `export const Chart = forwardRef(function Chart(props, ref) {
  const { frameProps = {} } = props;
  return <div style={{ ...frameProps }} />;
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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
