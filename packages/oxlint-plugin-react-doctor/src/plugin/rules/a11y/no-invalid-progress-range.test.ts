import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInvalidProgressRange } from "./no-invalid-progress-range.js";

describe("no-invalid-progress-range", () => {
  it("reports invalid native and ARIA progress ranges", () => {
    const result = runRule(
      noInvalidProgressRange,
      `const Progress = () => <>
         <progress value={11} max={10} />
         <progress value={-1} max={10} />
         <progress value={(-1 as number)} max={(10 as number)} />
         <progress value={1} max={0} />
         <div role="progressbar" aria-valuemin={10} aria-valuemax={5} aria-valuenow={7} />
         <div role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={12} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(6);
  });

  it("allows valid, indeterminate, and dynamic progress values", () => {
    const result = runRule(
      noInvalidProgressRange,
      `const Progress = ({ value, max, props }) => <>
         <progress />
         <progress value={5} max={10} />
         <progress value={value} max={max} />
         <div role="progressbar" aria-valuemin={0} aria-valuemax={10} aria-valuenow={5} />
         <div role="progressbar" aria-valuenow={value} {...props} />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores custom progress components and unrelated roles", () => {
    const result = runRule(
      noInvalidProgressRange,
      `const Progress = () => <>
         <ProgressBar value={20} max={10} />
         <div role="slider" aria-valuemin={0} aria-valuemax={10} aria-valuenow={20} />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
