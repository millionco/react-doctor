import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoProxyApis } from "./solid-no-proxy-apis.js";

describe("solid-no-proxy-apis", () => {
  it("flags import from solid-js/store", () => {
    const result = runRule(solidNoProxyApis, `import { createStore } from "solid-js/store";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Solid Store APIs");
  });

  it("flags new Proxy() expression", () => {
    const result = runRule(solidNoProxyApis, `const p = new Proxy({}, {});`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Proxies are incompatible");
  });

  it("flags Proxy.revocable() call", () => {
    const result = runRule(solidNoProxyApis, `const p = Proxy.revocable({}, {});`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Proxies are incompatible");
  });

  it("flags JSX spread with member expression", () => {
    const result = runRule(solidNoProxyApis, `const el = <div {...obj.props} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("property access in JSX spread");
  });

  it("flags JSX spread with call expression", () => {
    const result = runRule(solidNoProxyApis, `const el = <div {...getProps()} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("function call in JSX spread");
  });

  it("allows JSX spread with plain identifier", () => {
    const result = runRule(solidNoProxyApis, `const el = <div {...props} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags function argument in mergeProps", () => {
    const result = runRule(
      solidNoProxyApis,
      `import { mergeProps } from "solid-js";
       const merged = mergeProps(() => ({ a: 1 }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("function");
  });

  it("flags non-props identifier in mergeProps", () => {
    const result = runRule(
      solidNoProxyApis,
      `import { mergeProps } from "solid-js";
       const merged = mergeProps(defaults);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("non-props identifier");
  });

  it("allows props-like identifier in mergeProps", () => {
    const result = runRule(
      solidNoProxyApis,
      `import { mergeProps } from "solid-js";
       const merged = mergeProps(myProps);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-solid imports", () => {
    const result = runRule(solidNoProxyApis, `import { something } from "other-lib";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags spread element in mergeProps", () => {
    const result = runRule(
      solidNoProxyApis,
      `import { mergeProps } from "solid-js";
       const merged = mergeProps(...items);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("function (or spread)");
  });
});
