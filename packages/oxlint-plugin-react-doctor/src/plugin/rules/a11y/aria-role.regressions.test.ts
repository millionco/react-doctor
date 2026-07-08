import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { ariaRole } from "./aria-role.js";

describe("a11y/aria-role regressions", () => {
  it("does not flag a domain role prop on a custom component", () => {
    const result = runRule(
      ariaRole,
      `export const Row = () => <MemberRow email="a@b.c" role="member" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag role={undefined} on a custom component", () => {
    const result = runRule(
      ariaRole,
      `export const Upload = () => (
        <Button component="label" role={undefined} tabIndex={-1}>Upload</Button>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a sentinel role prop on a custom component in a spec", () => {
    const result = runRule(ariaRole, `render(<CButton className="bazinga" role="bazinga" />);`, {
      filename: "src/components/button/__tests__/CButton.spec.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an invalid role on a DOM element", () => {
    const result = runRule(ariaRole, `export const A = () => <div role="datepicker" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags role={null} on a DOM element", () => {
    const result = runRule(ariaRole, `export const A = () => <div role={null} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a component mapped to a DOM tag via jsx-a11y settings", () => {
    const result = runRule(ariaRole, `export const A = () => <Div role="datepicker" />;`, {
      settings: { "jsx-a11y": { components: { Div: "div" } } },
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags custom components when ignoreNonDOM is explicitly false", () => {
    const result = runRule(ariaRole, `export const A = () => <Foo role="datepicker" />;`, {
      settings: { "react-doctor": { ariaRole: { ignoreNonDOM: false } } },
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
