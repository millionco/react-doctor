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

  it('exempts a text `<input role="combobox">` (its implicit role is textbox)', () => {
    const result = runRule(
      noRedundantRoles,
      `const F = () => <input type="text" role="combobox" aria-expanded aria-controls="lb" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts the canonical W3C APG combobox (aria-autocomplete + aria-controls + aria-expanded)", () => {
    const result = runRule(
      noRedundantRoles,
      `const F = ({ open }) => <input type="text" role="combobox" aria-autocomplete="list" aria-controls="lb" aria-expanded={open} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an input whose role matches its single implicit role", () => {
    const result = runRule(
      noRedundantRoles,
      `const F = () => <input type="checkbox" role="checkbox" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a spinbutton role repeated on a native number input", () => {
    const result = runRule(
      noRedundantRoles,
      `const F = () => <input type="number" role="spinbutton" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a redundant spinbutton role when the number type is an expression literal", () => {
    const result = runRule(
      noRedundantRoles,
      `const F = () => <input type={"number"} role="spinbutton" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not assume a redundant role when an input type is unresolved", () => {
    const result = runRule(
      noRedundantRoles,
      `const F = ({ inputType }) => <input type={inputType} role="textbox" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('exempts `<a role="link">` without `href` (a bare anchor has no implicit role)', () => {
    const result = runRule(
      noRedundantRoles,
      `const Go = () => <a role="link" tabIndex={0} onClick={() => go()}>Go</a>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags `<a href role="link">` (an anchor with href is genuinely a link)', () => {
    const result = runRule(noRedundantRoles, `const Go = () => <a role="link" href="/x">Go</a>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  for (const code of [
    `<td role="gridcell" />`,
    `<th role="gridcell" />`,
    `<th role="rowheader" />`,
  ]) {
    it(`exempts the W3C grid-pattern role in ${code} (only the primary default role is redundant)`, () => {
      expect(runRule(noRedundantRoles, code).diagnostics).toEqual([]);
    });
  }

  it('still flags `<td role="cell">` inside a plain same-file `<table>`', () => {
    const result = runRule(
      noRedundantRoles,
      `const T = () => <table><tbody><tr><td role="cell" /></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A component rendering a bare `<td>` may be composed into a
  // `<table role="grid">` in another file, where the implicit role is
  // gridcell — `role="cell"` there is a deliberate override, not redundant.
  it('does not flag `<td role="cell">` when no same-file table establishes the context', () => {
    expect(runRule(noRedundantRoles, `const C = () => <td role="cell" />;`).diagnostics).toEqual(
      [],
    );
  });

  it('does not flag `<td role="cell">` inside `<table role="grid">`', () => {
    const result = runRule(
      noRedundantRoles,
      `const G = () => <table role="grid"><tbody><tr><td role="cell" /></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // react-aria markup (data-rac) re-applies explicit roles because
  // CSS-restyled tables lose implicit semantics in some ATs.
  it('does not flag `<tr role="row" data-rac>` (react-aria table pattern)', () => {
    const result = runRule(
      noRedundantRoles,
      `const R = () => <tr className={classNames?.row} role="row" data-rac />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags `<tr role="row">` without react-aria markers', () => {
    const result = runRule(
      noRedundantRoles,
      `const R = ({ children }) => <tr role="row">{children}</tr>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
