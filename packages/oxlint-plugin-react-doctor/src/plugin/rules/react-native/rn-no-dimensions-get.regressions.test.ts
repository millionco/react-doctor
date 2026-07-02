import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoDimensionsGet } from "./rn-no-dimensions-get.js";

describe("react-native/rn-no-dimensions-get — regressions", () => {
  it("stays silent on a local object named Dimensions", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const Dimensions = new Map([["a", 1]]); export const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags Dimensions.get imported from react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native"; export const w = () => Dimensions.get("window");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a CJS destructured require of react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const { Dimensions } = require("react-native");\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a CJS member require of react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const Dimensions = require("react-native").Dimensions;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions.addEventListener via CJS require", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const { Dimensions } = require("react-native");\nDimensions.addEventListener("change", () => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a bare global Dimensions.get", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `export const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an initializer-less let Dimensions later assigned from react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `let Dimensions;\nDimensions = require("react-native").Dimensions;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions destructured from a react-native namespace import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as ReactNative from "react-native";\nconst { Dimensions } = ReactNative;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions member-aliased from a react-native namespace import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as ReactNative from "react-native";\nconst Dimensions = ReactNative.Dimensions;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on Dimensions member-aliased from an unrelated namespace import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as Store from "./my-dimensions-store";\nconst Dimensions = Store.Dimensions;\nexport const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on Dimensions imported from another module", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "./my-dimensions-store";\nexport const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on Dimensions required from another module", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const { Dimensions } = require("./my-dimensions-store");\nexport const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a react-native import is shadowed by a function-local Map", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";\nexport const value = () => {\n  const Dimensions = new Map([["a", 1]]);\n  return Dimensions.get("a");\n};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
