import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoFalsyAndRender } from "./rn-no-falsy-and-render.js";

describe("rn-no-falsy-and-render", () => {
  it("flags numeric-named identifier (count)", () => {
    const code = `const App = ({ count }) => <View>{count && <Text>Has</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("crash");
  });

  it("flags .length member expression", () => {
    const code = `const App = ({ items }) => <View>{items.length && <Text>Has</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags numeric-named member (data.totalCount)", () => {
    const code = `const App = ({ data }) => <View>{data.totalCount && <Text>Has</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags camelCase numeric names (itemCount, pageSize)", () => {
    const code = `const App = ({ itemCount }) => <View>{itemCount && <Text>Has</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag boolean-named identifiers (isVisible, enabled)", () => {
    const code = `const App = ({ isVisible }) => <View>{isVisible && <Text>Visible</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag string-named identifiers (title, name, username)", () => {
    const code = `const App = ({ title }) => <View>{title && <Text>{title}</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag object-named identifiers (user, data, item)", () => {
    const code = `const App = ({ user }) => <View>{user && <Profile user={user} />}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag boolean comparison (> 0)", () => {
    const code = `const App = ({ count }) => <View>{count > 0 && <Text>Has</Text>}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag ternary (not &&)", () => {
    const code = `const App = ({ count }) => <View>{count ? <Text>Has</Text> : null}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag && outside JSX context", () => {
    const code = `const result = count && renderItem();`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag && where right side is not JSX", () => {
    const code = `const App = () => <View>{count && "text"}</View>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag boolean-prefixed numeric names (isPage, hasCount, showTotal)", () => {
    const code = `const App = ({ isPage, hasCount, showTotal }) => (
      <View>
        {isPage && <Text>Page</Text>}
        {hasCount && <Text>Count</Text>}
        {showTotal && <Text>Total</Text>}
      </View>
    );`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag anything in a 'use dom' file", () => {
    const code = `"use dom";\nconst App = ({ count }) => <div>{count && <span>Has</span>}</div>;`;
    const result = runRule(rnNoFalsyAndRender, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
