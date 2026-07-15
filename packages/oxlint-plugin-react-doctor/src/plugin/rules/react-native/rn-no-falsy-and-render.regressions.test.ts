import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoFalsyAndRender } from "./rn-no-falsy-and-render.js";

describe("react-native/rn-no-falsy-and-render — regressions", () => {
  it("stays silent on a numeric gate rendered inside a DOM host", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `interface CookieCardProps {
  cookie: { maxAge?: string };
}
const CookieCard = ({ cookie }: CookieCardProps) => (
  <div className="grid">
    {cookie.maxAge && (
      <div><span>Max-Age:</span> {cookie.maxAge}</div>
    )}
  </div>
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `<div>{itemCount && <span>Items</span>}</div>`,
    `<svg>{itemCount && <text>Items</text>}</svg>`,
    `<div><>{itemCount && <span>Items</span>}</></div>`,
    `<div><Fragment>{itemCount && <span>Items</span>}</Fragment></div>`,
    `<div><React.Fragment>{itemCount && <span>Items</span>}</React.Fragment></div>`,
    `<div children={itemCount && <span>Items</span>} />`,
    `createPortal(<div>{itemCount && <span>Items</span>}</div>, document.body)`,
  ])("stays silent when the numeric gate reaches a proven DOM host: %s", (renderedValue) => {
    const result = runRule(rnNoFalsyAndRender, `const Card = ({ itemCount }) => ${renderedValue};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `<View>{itemCount && <Text>Items</Text>}</View>`,
    `<NativeView>{itemCount && <NativeText>Items</NativeText>}</NativeView>`,
    `<>{itemCount && <Text>Items</Text>}</>`,
    `<Panel>{itemCount && <span>Items</span>}</Panel>`,
    `<div><Panel>{itemCount && <span>Items</span>}</Panel></div>`,
    `createPortal(<>{itemCount && <span>Items</span>}</>, document.body)`,
    `<div content={<>{itemCount && <span>Items</span>}</>} />`,
    `<List renderItem={() => <>{itemCount && <Text>Items</Text>}</>} />`,
    `<mesh>{itemCount && <group />}</mesh>`,
  ])("retains unknown or React Native renderer positives: %s", (renderedValue) => {
    const result = runRule(
      rnNoFalsyAndRender,
      `import { Text, View, Text as NativeText, View as NativeView } from "react-native";
const Card = ({ itemCount }) => ${renderedValue};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a configured custom component as intrinsic DOM proof", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const Card = ({ itemCount }) => <Panel>{itemCount && <span>Items</span>}</Panel>;`,
      { settings: { "jsx-a11y": { components: { Panel: "div" } } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a locally bound Fragment component as transparent", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const Fragment = ({ children }) => <Panel>{children}</Panel>;
      const Card = ({ itemCount }) => (
        <div><Fragment>{itemCount && <span>Items</span>}</Fragment></div>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a boolean useState named with a numeric-sounding word", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = () => {
  const [progress, setProgress] = useState(false);
  return <View>{progress && <Spinner />}</View>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a numeric .length gate", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = ({ items }) => <View>{items.length && <List />}</View>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a non-zero numeric literal const", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const Comp = () => {
  const count = 5;
  return <>{count && <Item />}</>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a useState(0)-derived numeric gate", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = () => {
  const [count, setCount] = useState(0);
  return <View>{count && <Item />}</View>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a let literal that can be reassigned to a numeric value", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = ({ items }) => {
  let count = 5;
  count = items.length;
  return <View>{count && <List />}</View>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a boolean useState gated inside a nested callback", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = () => {
  const [progress, setProgress] = useState(false);
  return <FlatList data={items} renderItem={() => progress && <Spinner />} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot: a nested component's boolean useState of the same name must not mask
  // the outer numeric `useState(0)` gate — that would hide a real bare-0 crash.
  it("still flags an outer numeric gate when a nested component reuses the name as boolean", () => {
    const result = runRule(
      rnNoFalsyAndRender,
      `const C = () => {
  const [progress, setProgress] = useState(0);
  const Inner = () => {
    const [progress, setProgress] = useState(false);
    return <View>{progress && <Dot />}</View>;
  };
  return <View>{progress && <Bar />}</View>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
