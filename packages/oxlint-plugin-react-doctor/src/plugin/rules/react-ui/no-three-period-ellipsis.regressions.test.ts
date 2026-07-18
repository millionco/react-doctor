import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noThreePeriodEllipsis } from "./no-three-period-ellipsis.js";

const run = (code: string) => runRule(noThreePeriodEllipsis, code, { filename: "fixture.tsx" });

describe("react-ui/no-three-period-ellipsis — regressions", () => {
  it("reports static user-facing attribute text", () => {
    const result = run(
      `const Search = () => <><input placeholder="Search..." aria-label={'Search files...'} /><img alt={\`Loading...\`} /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports ellipses after non-Latin letters", () => {
    const result = run(`const Search = () => <input placeholder="搜索对话..." />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves dynamic attributes and non-user-facing values alone", () => {
    const result = run(
      `const Search = ({ label }) => <input placeholder={label} data-state="Loading..." />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports JSX text", () => {
    const result = run(`const Loading = () => <span>Loading...</span>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports static text branches rendered from expressions", () => {
    const result = run(
      'const Controls = ({ isAdding, isSaving }) => <><button>{isAdding ? "Adding..." : "Add decision"}</button><span>{isSaving && `Saving...`}</span></>;',
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("leaves dynamic expression text and code examples alone", () => {
    const result = run(
      `const Controls = ({ label, format }) => <><span>{label}</span><span>{format("Loading...")}</span><code>{true ? "Loading..." : "Done"}</code></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report expression attributes twice", () => {
    const result = run("const Search = () => <input aria-label={`Searching...`} />;");
    expect(result.diagnostics).toHaveLength(1);
  });
});
