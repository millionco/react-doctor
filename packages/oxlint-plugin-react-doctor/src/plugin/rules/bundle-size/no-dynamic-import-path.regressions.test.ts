import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  // Verify wave: Node build tasks / CLI tooling (gulpfiles, gatsby's CLI,
  // GitHub Action scripts) require() computed paths by design and never ship
  // in a browser bundle — the "ships in the main bundle" claim is inapplicable.
  it("stays silent on a dynamic require() in a file importing node builtins", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        import { join } from "path";
        import { readFileSync } from "fs";
        const loadTheme = (themeDirectory) => require(join(themeDirectory, "theme.js"));
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a dynamic import() in a file importing node: builtins", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        import { resolve } from "node:path";
        const loadAdapter = async (adapterPath) => await import(resolve(adapterPath));
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a dynamic require() in a CommonJS gulp task", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        const { parallel } = require("gulp");
        const loadTask = (taskPath) => require(taskPath);
        module.exports = { loadTask };
      `,
      { filename: "gulpfile.cjs" },
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a dynamic require() next to require-cache busting", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        export const requireUncached = (file) => {
          delete require.cache[require.resolve(file)];
          return require(file);
        };
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a dynamic require() in a file using process.cwd()", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "export const loadManifest = () => require(`${process.cwd()}/manifest.js`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on a dynamic require() in an express middleware module", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        import { json } from "express";
        export const loadFunction = (pathToFunction) => require(pathToFunction);
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Verify wave: `const moduleName = "sharp"; import(moduleName)` is the
  // deliberate indirection that keeps an optional Node-only dependency OUT of
  // the bundle — telling the author to inline the literal would undo it.
  it("stays silent on an identifier resolving to a const string literal", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        const loadSharp = async () => {
          const sharpName = "sharp";
          const sharpModule = await import(sharpName);
          return sharpModule.default ?? sharpModule;
        };
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on require() of a const string literal binding", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        const getDateFnsTz = () => {
          const dateFnsTzModuleName = "date-fns-tz";
          return require(dateFnsTzModuleName);
        };
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on import() of a const CDN URL binding", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        const TRANSFORMERS_CDN_URL = "https://esm.sh/@huggingface/transformers@3.8.1?bundle";
        export const loadTransformers = () => import(TRANSFORMERS_CDN_URL);
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Verify wave: a blob URL created one line above has no module the bundler
  // could ever split — import(url) is the only way to run an inline script.
  it("stays silent on import() of a const URL.createObjectURL binding", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        export const runInlineModule = (sourceText) => {
          const blob = new Blob([sourceText], { type: "text/javascript" });
          const url = URL.createObjectURL(blob);
          return import(url).finally(() => URL.revokeObjectURL(url));
        };
      `,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags an identifier resolving to a reassignable let binding", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      `
        export const load = (feature) => {
          let modulePath = "./features/base.js";
          if (feature) modulePath = feature;
          return import(modulePath);
        };
      `,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Verify wave: interpolating only the query string (`?test=${random}`
  // cache-busting) leaves the module path itself fully static.
  it("stays silent when only the query string is interpolated", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const loadFresh = () => import(`../useSelectionArea?test=${Math.random()}`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Verify wave: `@/`-alias template paths resolve through the same bundler
  // context-module machinery as `./` relative paths.
  it("stays silent on an alias-prefixed template with a static directory", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const loadMessages = (locale) => import(`@/locales/${locale}/common.json`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Docs-validation wave: a scoped-package specifier with a static directory
  // before the hole gets the same webpack context-module treatment as
  // `./locales/${lang}` — a plain-string path is impossible for runtime locale
  // loading (lobe-ui EmojiPicker shape), so it must not be flagged.
  it("stays silent on a scoped-package template path with a static directory", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const loadI18n = (locale) => import(`@emoji-mart/data/i18n/${locale}.json`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Verify wave: probing an installed package's manifest version is a Node
  // idiom (`require(`${pkg}/package.json`).version`), never a bundle concern.
  it("stays silent on a require() targeting a package.json manifest", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const versionOf = (packageName) => require(`${packageName}/package.json`).version;",
    );
    expect(diagnostics).toHaveLength(0);
  });

  // Docs-validation wave: same context-module carve-out for a bare package
  // specifier — `require(\`react-intl/locale-data/${locale}\`)` resolves to a
  // context over the locale-data dir, and plain-string paths would ship the
  // exact same bytes (cboard i18n shape).
  it("stays silent on a bare-package template require with a static directory", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const loadLocale = (locale) => require(`react-intl/locale-data/${locale}`);",
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a package-root template whose hole immediately follows the package name", () => {
    const { diagnostics } = runRule(
      noDynamicImportPath,
      "const loadPlugin = (name) => import(`some-pkg/${name}`);",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Docs-validation wave: `/* webpackIgnore: true */` + `/* @vite-ignore */`
  // explicitly opt the import out of bundling — runtime plugin scripts have no
  // chunk the bundler could ever split (react-cosmos playground shape).
  it("stays silent on an import annotated with webpackIgnore/@vite-ignore", () => {
    const directory = mkdtempSync(join(tmpdir(), "no-dynamic-import-path-annotation-"));
    const filename = join(directory, "playground.tsx");
    const code = `async function loadPluginScript(scriptPath: string) {
  const normalizedPath = scriptPath.startsWith("/") ? scriptPath : \`/\${scriptPath}\`;
  await import(
    /* webpackIgnore: true */
    /* @vite-ignore */
    \`./_plugin\${normalizedPath}\`
  );
}`;
    writeFileSync(filename, code);
    try {
      const { diagnostics } = runRule(noDynamicImportPath, code, { filename });
      expect(diagnostics).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("still flags an unannotated import in a file that annotates a different import", () => {
    const directory = mkdtempSync(join(tmpdir(), "no-dynamic-import-path-annotation-"));
    const filename = join(directory, "loader.tsx");
    const code = `export const loadRemote = (url: string) => import(/* @vite-ignore */ url);
export const loadLocal = (name: string) => import(\`./\${name}/index.js\`);`;
    writeFileSync(filename, code);
    try {
      const { diagnostics } = runRule(noDynamicImportPath, code, { filename });
      expect(diagnostics).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
