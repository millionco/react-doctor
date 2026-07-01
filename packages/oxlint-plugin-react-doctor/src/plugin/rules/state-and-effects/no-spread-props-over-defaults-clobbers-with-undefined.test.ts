import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSpreadPropsOverDefaultsClobbersWithUndefined } from "./no-spread-props-over-defaults-clobbers-with-undefined.js";

describe("no-spread-props-over-defaults-clobbers-with-undefined", () => {
  it("flags { ...defaultProps, ...props } in a component with JSX", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const VictoryContainer = (props: VictoryContainerProps) => {
        const merged = { ...defaultProps, ...props };
        return <svg width={merged.width} />;
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a PascalCase component that merges config defaults over props", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `function Lightbox({ ...props }: LightboxProps) {
        const settings = { ...defaultLightboxProps, ...props };
        return settings;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a destructured merge of theme defaults over props", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const ReactSearchAutocomplete = (props: Props) => {
        const { showIcon, ...rest } = { ...defaultTheme, ...props };
        return rest;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a plain config/util merge outside component context", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `export const trashPagination = (opts: RequestOpts) =>
        request({ ...defaultRequestConfig, ...opts });`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag in a test file", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const FileTokenGroup = (props: Props) => {
        const merged = { ...defaultProps, ...props };
        return <div {...merged} />;
      };`,
      { filename: "file-token-group.test.tsx" }
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the later operand is an object literal (single spread)", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Box = () => {
        const merged = { ...defaults, width: 100, height: 50 };
        return <div style={merged} />;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the later operand is a fully-required inline type", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `function useMerge(requiredConfig: { a: number; b: number }) {
        const merged = { ...defaults, ...requiredConfig };
        return merged;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the first operand is not a defaults identifier", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Panel = (props: Props) => {
        const merged = { ...base, ...props };
        return <div {...merged} />;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the later spread is an inline object literal", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Panel = (props: Props) => {
        const merged = { ...defaults, ...{ width: 1 } };
        return <div {...merged} />;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an optional-typed props binding that is not literally named props", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Widget = (incoming: WidgetProps) => {
        const merged = { ...defaultProps, ...incoming };
        return <div {...merged} />;
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
