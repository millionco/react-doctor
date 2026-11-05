import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";

const curatedOptions = {
  filename: "src/components/Panel.tsx",
  settings: { "react-doctor": { framework: "vite", portedRuleMode: "curated" } },
};

describe("only-export-components default function overloads", () => {
  it("classifies only the named runtime component behind default overloads", () => {
    const result = runRule(
      onlyExportComponents,
      `
        import type { ReactElement } from "react";
        export interface PanelProps { title: string }
        export default function Panel(props: PanelProps): ReactElement;
        export default function Panel(props: { title: number }): ReactElement;
        export default function Panel(props: { title: string | number }) {
          return <p>{props.title}</p>;
        }
      `,
      curatedOptions,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains the non-component finding on an overloaded utility implementation", () => {
    const result = runRule(
      onlyExportComponents,
      `
        export default function convert(value: string): number;
        export default function convert(value: string) {
          return Number(value);
        }
        export const Panel = () => <p />;
      `,
      curatedOptions,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("non-component");
  });

  it("continues reporting an anonymous default component", () => {
    const result = runRule(
      onlyExportComponents,
      "export default function () { return <p />; }",
      curatedOptions,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("unnamed");
  });

  it("leaves the upstream port profile unchanged", () => {
    const result = runRule(
      onlyExportComponents,
      `
        import type { ReactElement } from "react";
        export default function Panel(): ReactElement;
        export default function Panel() { return <p />; }
      `,
      {
        filename: "src/components/Panel.tsx",
        settings: { "react-doctor": { portedRuleMode: "upstream" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("unnamed");
  });
});
