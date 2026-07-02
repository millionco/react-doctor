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

  // Bugbot wave 4: the require() arm must mirror the import() arm — a static
  // directory prefix lets the bundler build a context module, so it is NOT
  // flagged for require() either.
  it("stays silent on a require() template literal with a static directory prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (lang) => require(`./locales/${lang}.js`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a require() template literal with no static prefix", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (dir, name) => require(`${dir}/${name}.js`);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot wave 4 (round 2): the static-prefix exemption is relative-specifier
  // only. The bundler context-module glob does not apply to a protocol or
  // absolute prefix, so those interpolated paths must still be flagged even
  // though their first quasi contains a `/`.
  it("still flags a protocol-prefixed dynamic import URL", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (version) => import(`https://cdn.example/${version}/lib.js`);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an absolute-prefixed dynamic require path", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (version) => require(`/assets/${version}/lib.js`);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: a relative prefix with NO static directory segment before the first
  // hole (`./${pkg}/index.js`) scopes the context to the whole directory, so it
  // is not meaningfully code-split and must still be flagged.
  it("still flags a relative import whose hole immediately follows ./", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (pkg) => import(`./${pkg}/index.js`);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // …but a real static directory segment (`./locales/${lang}.js`) IS scoped and
  // stays silent.
  it("stays silent on a relative import with a static directory segment", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const load = (lang) => import(`./locales/${lang}.js`);",
    );
    expect(diagnostics).toHaveLength(0);
  });
});
