import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAssertiveStatus } from "./no-assertive-status.js";

describe("no-assertive-status", () => {
  it("reports an assertive status", () => {
    const result = runRule(
      noAssertiveStatus,
      `const SaveState = () => <div role="status" aria-live="assertive">Saved</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports brace-wrapped and case-insensitive values", () => {
    const result = runRule(
      noAssertiveStatus,
      `const SaveState = () => <output role={"STATUS"} aria-live={"ASSERTIVE"}>Saved</output>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows polite statuses and imperative alerts", () => {
    const result = runRule(
      noAssertiveStatus,
      `const State = () => <><div role="status" aria-live="polite">Saved</div><div role="alert" aria-live="assertive">Connection lost</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic values and trailing spreads", () => {
    const result = runRule(
      noAssertiveStatus,
      `const A = ({ live }) => <div role="status" aria-live={live} />;
       const B = ({ props }) => <div role="status" aria-live="assertive" {...props} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips unresolved custom components", () => {
    const result = runRule(
      noAssertiveStatus,
      `const SaveState = () => <Status role="status" aria-live="assertive" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
