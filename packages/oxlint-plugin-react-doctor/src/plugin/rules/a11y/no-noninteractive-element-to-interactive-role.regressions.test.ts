import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveElementToInteractiveRole } from "./no-noninteractive-element-to-interactive-role.js";

describe("a11y/no-noninteractive-element-to-interactive-role regressions", () => {
  describe("ARIA listbox pattern (ul/li)", () => {
    it('stays silent on <ul role="listbox">', () => {
      expect(
        runRule(
          noNoninteractiveElementToInteractiveRole,
          `<ul role="listbox" aria-label="Options"><li role="option">One</li></ul>`,
        ).diagnostics,
      ).toEqual([]);
    });

    it('stays silent on <li role="option"> with selection wiring', () => {
      expect(
        runRule(
          noNoninteractiveElementToInteractiveRole,
          `<li role="option" aria-selected={isSelected} onClick={handleSelect}>Item</li>`,
        ).diagnostics,
      ).toEqual([]);
    });

    it('stays silent on <ol role="listbox">', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<ol role="listbox" />`).diagnostics,
      ).toEqual([]);
    });
  });

  describe("ARIA data-grid pattern (table/td)", () => {
    it('stays silent on <table role="grid">', () => {
      expect(
        runRule(
          noNoninteractiveElementToInteractiveRole,
          `<table role="grid" onKeyDown={handleNavigation} aria-multiselectable="true" />`,
        ).diagnostics,
      ).toEqual([]);
    });

    it('stays silent on <td role="gridcell">', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<td role="gridcell" tabIndex={-1} />`)
          .diagnostics,
      ).toEqual([]);
    });
  });

  describe("ARIA tabs pattern (nav)", () => {
    it('stays silent on <nav role="tablist">', () => {
      expect(
        runRule(
          noNoninteractiveElementToInteractiveRole,
          `<nav role="tablist" aria-label="Sections" />`,
        ).diagnostics,
      ).toEqual([]);
    });
  });

  describe("non-focusable separators are static structure", () => {
    it('stays silent on <li role="separator"> without tabIndex', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<li role="separator" />`).diagnostics,
      ).toEqual([]);
    });

    it('still fires on a focusable <li role="separator">', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<li role="separator" tabIndex={0} />`)
          .diagnostics,
      ).toHaveLength(1);
    });
  });

  describe("still fires on misapplied interactive roles", () => {
    it('fires on <ul role="button">', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<ul role="button" />`).diagnostics,
      ).toHaveLength(1);
    });

    it('fires on <li role="combobox">', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<li role="combobox" />`).diagnostics,
      ).toHaveLength(1);
    });

    it('fires on <table role="listbox">', () => {
      expect(
        runRule(noNoninteractiveElementToInteractiveRole, `<table role="listbox" />`).diagnostics,
      ).toHaveLength(1);
    });
  });
});
