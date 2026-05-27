import { describe, expect, it } from "vite-plus/test";
import { isCanonicalReactNamespaceName } from "../src/plugin/utils/is-canonical-react-namespace-name.js";

describe("isCanonicalReactNamespaceName", () => {
  it("matches the exact `React` and `react` identifiers", () => {
    expect(isCanonicalReactNamespaceName("React")).toBe(true);
    expect(isCanonicalReactNamespaceName("react")).toBe(true);
  });

  it("matches transpiled `_react*` and `_React*` prefixes", () => {
    expect(isCanonicalReactNamespaceName("_react")).toBe(true);
    expect(isCanonicalReactNamespaceName("_react2")).toBe(true);
    expect(isCanonicalReactNamespaceName("_React")).toBe(true);
    expect(isCanonicalReactNamespaceName("_ReactNamespace")).toBe(true);
  });

  it("does NOT match identifiers that merely start with `React` / `react`", () => {
    expect(isCanonicalReactNamespaceName("Reactor")).toBe(false);
    expect(isCanonicalReactNamespaceName("Reactosaurus")).toBe(false);
    expect(isCanonicalReactNamespaceName("reactor")).toBe(false);
    expect(isCanonicalReactNamespaceName("ReactStuff")).toBe(false);
  });

  it("does NOT match arbitrary unrelated identifiers", () => {
    expect(isCanonicalReactNamespaceName("Dispatcher")).toBe(false);
    expect(isCanonicalReactNamespaceName("MyTestRenderer")).toBe(false);
    expect(isCanonicalReactNamespaceName("_myLib")).toBe(false);
    expect(isCanonicalReactNamespaceName("")).toBe(false);
  });
});
