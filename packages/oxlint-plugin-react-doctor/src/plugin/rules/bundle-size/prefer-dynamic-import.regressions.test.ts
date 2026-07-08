import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferDynamicImport } from "./prefer-dynamic-import.js";

const expectFail = (code: string): void => {
  const result = runRule(preferDynamicImport, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(preferDynamicImport, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("bundle-size/prefer-dynamic-import — regressions", () => {
  it("flags a runtime import of a heavy library", () => {
    expectFail(`
      import { Chart } from "chart.js";
      Chart.register();
    `);
  });

  it("flags a heavy library component rendered as JSX", () => {
    expectFail(`
      import { Bar } from "react-chartjs-2";
      export const BarChart = () => <Bar />;
    `);
  });

  it("flags a bare side-effect import of a heavy library", () => {
    expectFail(`import "chart.js";`);
  });

  // Verify wave: imports whose bindings are used only in type annotations are
  // erased at emit time — `import { ChartConfiguration } from "chart.js"` used
  // purely as a type ships zero runtime code.
  it("stays silent when every binding is used only in type positions", () => {
    expectPass(`
      import { ChartConfiguration, TooltipItem } from "chart.js";
      export const buildConfig = (item: TooltipItem<"bar">): ChartConfiguration => {
        return { type: "bar", data: { datasets: [] } };
      };
    `);
  });

  it("stays silent when the binding appears only in a cast", () => {
    expectPass(`
      import { Chart } from "chart.js";
      export const getChart = (ref: { current: unknown }) => ref.current as Chart;
    `);
  });

  it("stays silent when the binding appears only in a generic argument", () => {
    expectPass(`
      import { TooltipProps } from "recharts";
      export const CustomTooltip = (props: TooltipProps<number, string>) => {
        return <div>{String(props.active)}</div>;
      };
    `);
  });

  it("stays silent when the imported binding is never referenced", () => {
    expectPass(`
      import { ChartData } from "chart.js";
      export const nothing = 1;
    `);
  });

  it("still flags when one binding of a mixed import is runtime-used", () => {
    expectFail(`
      import { Chart, ChartConfiguration } from "chart.js";
      export const register = () => Chart.register();
      export type Config = ChartConfiguration;
    `);
  });

  it("still flags a runtime binding referenced through typeof and a call", () => {
    expectFail(`
      import { Chart } from "chart.js";
      export const instance = new Chart();
    `);
  });

  it("still flags a re-exported heavy import", () => {
    expectFail(`
      import { Chart } from "chart.js";
      export { Chart };
    `);
  });

  // Verify wave FN: mermaid (~1MB) belongs in the heavy-library set.
  it("flags an eager runtime import of mermaid", () => {
    expectFail(`
      import mermaid from "mermaid";
      export const render = (definition: string) => mermaid.render("graph", definition);
    `);
  });
});
