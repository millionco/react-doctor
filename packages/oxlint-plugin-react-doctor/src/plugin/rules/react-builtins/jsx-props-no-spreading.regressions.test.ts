import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxPropsNoSpreading } from "./jsx-props-no-spreading.js";

describe("react-builtins/jsx-props-no-spreading — regressions", () => {
  // prod-fp 2026-07: codebases that spread do it pervasively (avg 98
  // firings per affected run). One diagnostic per file is the signal;
  // the rest is noise.
  it("reports at most one spread per file", () => {
    const result = runRule(
      jsxPropsNoSpreading,
      `const One = (props) => <Button {...props} />;
      const Two = (props) => <Card {...props} />;
      const Three = (props) => <input {...props} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a single spread", () => {
    const result = runRule(jsxPropsNoSpreading, `const One = (props) => <App {...props} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // A skipped (excepted) spread must not consume the per-file report.
  it("reports the first NON-exempt spread when earlier spreads are excepted", () => {
    const result = runRule(
      jsxPropsNoSpreading,
      `const el = <><Image {...props} /><Card {...props} /></>;`,
      {
        settings: {
          "react-doctor": { jsxPropsNoSpreading: { exceptions: ["Image"] } },
        },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when every spread is excepted", () => {
    const result = runRule(jsxPropsNoSpreading, `const el = <Image {...props} />;`, {
      settings: {
        "react-doctor": { jsxPropsNoSpreading: { exceptions: ["Image"] } },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
