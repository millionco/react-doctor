import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDynamicImportPath } from "./no-dynamic-import-path.js";

describe("bundle-size/no-dynamic-import-path — regressions", () => {
  it("stays silent on a template literal with a static directory prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (lang) => import(`./locales/${lang}.js`);"
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a fully-dynamic import(identifier)", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `const load = (p) => import(p);`
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a template literal with no static prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (dir, name) => import(`${dir}/${name}.js`);"
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot wave 4: the require() arm must mirror the import() arm — a static
  // directory prefix lets the bundler build a context module, so it is NOT
  // flagged for require() either.
  it("stays silent on a require() template literal with a static directory prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (lang) => require(`./locales/${lang}.js`);"
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a require() template literal with no static prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (dir, name) => require(`${dir}/${name}.js`);"
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
