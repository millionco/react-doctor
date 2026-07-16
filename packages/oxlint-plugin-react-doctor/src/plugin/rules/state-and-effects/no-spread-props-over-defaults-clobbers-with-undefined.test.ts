import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSpreadPropsOverDefaultsClobbersWithUndefined } from "./no-spread-props-over-defaults-clobbers-with-undefined.js";

describe("no-spread-props-over-defaults-clobbers-with-undefined", () => {
  it("flags { ...defaultProps, ...props } whose merge result feeds arithmetic", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const VictoryContainer = (props: VictoryContainerProps) => {
        const merged = { ...defaultProps, ...props };
        return <svg width={merged.width * 2} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a component whose merged setting flows into a call argument", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `function Lightbox({ ...props }: LightboxProps) {
        const settings = { ...defaultLightboxProps, ...props };
        return <div style={{ width: Math.min(settings.width, 500) }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a destructured merge key that flows into a computation", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const ReactSearchAutocomplete = (props: Props) => {
        const { maxResults, ...rest } = { ...defaultTheme, ...props };
        return <ul>{props.items.slice(0, maxResults * 1)}</ul>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hook that computes with a defaults-over-options merge", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const useCarousel = (options: CarouselOptions) => {
        const merged = { ...defaultCarouselOptions, ...options };
        return Math.abs(merged.slideSpeed);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags spreading a static defaultProps member under props that feed a computation", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const List = (props: ListProps) => {
        const merged = { ...List.defaultProps, ...props };
        return <ul data-count={Math.min(merged.pageSize, 50)} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags spreading the rest of destructured props over defaults into arithmetic", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Button = ({ className, ...rest }: ButtonProps) => {
        const merged = { ...defaultButtonProps, ...rest };
        return <button style={{ width: merged.width - 4 }} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-typed props binding that is not literally named props", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Widget = (incoming: WidgetProps) => {
        const merged = { ...defaultProps, ...incoming };
        return <div>{Math.round(merged.ratio)}</div>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a visible defaulted key destructured from the merge that feeds a call argument", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const DEFAULT_PROPS = { color: "grey.t07" };
      function Divider(_props) {
        const props = { ...DEFAULT_PROPS, ..._props };
        const { color, testId } = props;
        const circleColor = theme.getColor(color);
        return <svg data-testid={testId} fill={circleColor} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags imported defaults whose merged key feeds arithmetic in a timer", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `import { defaultProps } from "./defaultProps";
      export const Carousel = (userProps: CarouselProps) => {
        const props = { ...defaultProps, ...userProps };
        setTimeout(() => slide(), props.transition * 1000);
        return <div />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the only defaulted key is re-wrapped and the whole merge goes to an omit call", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const defaultProps = { groupComponent: "g" };
      const VictoryPortal = (initialProps: VictoryPortalProps) => {
        const props = { ...defaultProps, ...initialProps };
        const { groupComponent } = props;
        const standardProps = { groupComponent, standalone: false };
        const newProps = merge(standardProps, omit(props, ["children", "groupComponent"]));
        return <g {...newProps} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the whole merge and the visible defaults are handed to a re-defaulting hook", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const DEFAULT_PROPS = { direction: "row" };
      function Flex(_props) {
        const props = { ...DEFAULT_PROPS, ..._props };
        const { children, testId } = props;
        const wrapperCSS = useResponsivePropsCSS(props, DEFAULT_PROPS, { margin: responsiveMargin });
        return <div css={wrapperCSS} data-testid={testId}>{children}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a destructured key that re-applies its default at the destructure", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Gauge = (props: GaugeProps) => {
        const { width = 100 } = { ...defaultGaugeProps, ...props };
        return <svg width={width * 2} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when only never-defaulted keys of a visible defaults literal feed computations", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const defaultProps = { groupComponent: "g" };
      const Portal = (initialProps: PortalProps) => {
        const props = { ...defaultProps, ...initialProps };
        return <div>{Math.min(props.width, 500)}</div>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the defaultProps-replacement merge that only forwards into JSX", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const VictoryContainer = (props: VictoryContainerProps) => {
        const merged = { ...DEFAULT_PROPS, ...props };
        return <svg {...merged} width={merged.width} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imperative config-patch setter merging an update over defaults", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `export const setMessageGlobalConfig = (update: ConfigUpdate) => {
        currentConfig = { ...defaultGlobalConfig, ...update };
        applyDuration(currentConfig.duration * 1000);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain config/util merge outside component context", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `export const trashPagination = (opts: RequestOpts) =>
        request({ ...defaultRequestConfig, ...opts });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a request helper co-located with a component in the same file", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const buildRequest = (opts: RequestOpts) =>
        request({ ...defaultRequestConfig, ...opts });
      export const Page = () => {
        return <div />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an options merge helper in a hooks file with no JSX", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `export const useFetch = (url: string) => fetch(url);
      const mergeRequestOptions = (options: RequestOptions) =>
        ({ ...defaultRequestOptions, ...options });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the developer already filtered undefined keys into a local named props", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Chart = (rawProps: ChartProps) => {
        const props = pickDefined(rawProps);
        const merged = { ...defaultChartTheme, ...props };
        return <svg width={merged.width * 2} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fresh object-literal binding named props", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Icon = () => {
        const props = { size: 16, color: "red" };
        const merged = { ...defaultIconTheme, ...props };
        return <svg width={merged.size * 2} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowing literal merged inside a map callback", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Grid = (gridProps: GridProps) => {
        const cells = gridProps.items.map((item) => {
          const props = { id: item.id };
          return { ...defaultCellTheme, ...props };
        });
        return <div>{cells.length}</div>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag in a test file", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const FileTokenGroup = (props: Props) => {
        const merged = { ...defaultProps, ...props };
        return <div style={{ width: merged.width * 2 }} />;
      };`,
      { filename: "file-token-group.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the later operand is an object literal (single spread)", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Box = () => {
        const merged = { ...defaults, width: 100, height: 50 };
        return <div width={merged.width * 2} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the later operand is a fully-required inline type", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `function useMerge(required: { a: number; b: number }) {
        const merged = { ...defaults, ...required };
        return merged.a + merged.b;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the first operand is not a defaults identifier", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Panel = (props: Props) => {
        const merged = { ...base, ...props };
        return <div width={merged.width * 2} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the later spread is an inline object literal", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      `const Panel = (props: Props) => {
        const merged = { ...defaults, ...{ width: 1 } };
        return <div width={merged.width * 2} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
