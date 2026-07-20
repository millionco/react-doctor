import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPresentationRoleConflict } from "./no-presentation-role-conflict.js";

describe("no-presentation-role-conflict", () => {
  it("reports focusable and globally labelled presentational elements", () => {
    const result = runRule(
      noPresentationRoleConflict,
      `const View = () => <><div role="presentation" tabIndex={0} /><span role="none" aria-label="Status" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports a decorative image that remains focusable", () => {
    const result = runRule(
      noPresentationRoleConflict,
      `const Logo = () => <img alt="" src="logo.svg" tabIndex={-1} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts purely presentational and dynamic-role elements", () => {
    const result = runRule(
      noPresentationRoleConflict,
      `const View = ({ role }) => <><div role="presentation" /><div role={role} tabIndex={0} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts redundant hidden state on decorative elements", () => {
    const result = runRule(
      noPresentationRoleConflict,
      `const View = () => <><img alt="" aria-hidden="true" src="logo.svg" /><span role="presentation" aria-hidden="true" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
