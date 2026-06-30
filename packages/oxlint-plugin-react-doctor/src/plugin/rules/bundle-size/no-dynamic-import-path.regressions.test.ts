import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDynamicImportPath } from "./no-dynamic-import-path.js";

describe("bundle-size/no-dynamic-import-path — regressions", () => {
  it("stays silent on a template literal with a static directory prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (lang) => import(`./locales/${lang}.js`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a fully-dynamic import(identifier)", () => {
    const { diagnostics } = runRule(noDynamicImportPath, `const load = (p) => import(p);`);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a template literal with no static prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (dir, name) => import(`${dir}/${name}.js`);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
