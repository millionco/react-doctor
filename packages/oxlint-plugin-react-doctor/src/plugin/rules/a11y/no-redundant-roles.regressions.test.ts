import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRedundantRoles } from "./no-redundant-roles.js";

describe("a11y/no-redundant-roles regressions", () => {
  it('exempts `<ul role="list">` (Safari/VoiceOver list-semantics workaround) by default', () => {
    const result = runRule(noRedundantRoles, `const Nav = () => <ul role="list" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('exempts `<ol role="list">` by default', () => {
    const result = runRule(noRedundantRoles, `const Nav = () => <ol role="list" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags genuinely redundant roles on other elements", () => {
    const result = runRule(noRedundantRoles, `const Nav = () => <nav role="navigation" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
