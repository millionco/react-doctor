import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { forbidComponentProps } from "./forbid-component-props.js";

const withForbid = (forbid: ReadonlyArray<unknown>) => ({
  "react-doctor": { forbidComponentProps: { forbid } },
});

describe("react-builtins/forbid-component-props — regressions", () => {
  // prod-fp 2026-07: without config the OXC default forbid list
  // [className, style] flagged the canonical Tailwind/shadcn pattern on
  // every component usage (avg 639 firings per affected run). Enabled
  // without an explicit `forbid` list, the rule must stay inert.
  it("stays silent without an explicit forbid config (className)", () => {
    const result = runRule(forbidComponentProps, `const el = <Button className="p-2" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent without an explicit forbid config (style)", () => {
    const result = runRule(forbidComponentProps, `const el = <Card style={{ color: "red" }} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the configured forbid list is empty", () => {
    const result = runRule(forbidComponentProps, `const el = <Button className="p-2" />;`, {
      settings: withForbid([]),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The configured path is the rule's whole purpose — keep it firing.
  it("still flags a prop named in an explicit forbid config", () => {
    const result = runRule(forbidComponentProps, `const el = <Button className="p-2" />;`, {
      settings: withForbid(["className"]),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still honors allowedFor in an explicit entry config", () => {
    const result = runRule(
      forbidComponentProps,
      `const el = <><Icon className="a" /><Button className="b" /></>;`,
      { settings: withForbid([{ propName: "className", allowedFor: ["Icon"] }]) },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
