import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDynamicImportPath } from "./no-dynamic-import-path.js";

describe("no-dynamic-import-path transparent expressions", () => {
  it.each([
    `import('./theme.css' as string)`,
    `import('./theme.css' satisfies string)`,
    `import(('./theme.css' as string)!)`,
    `require('./theme.css' as string)`,
    "import(`./locales/${locale}.js` as string)",
    "require(`./locales/${locale}.js` satisfies string)",
  ])("accepts a static path through %s", (expression) => {
    const result = runRule(noDynamicImportPath, `const load = () => ${expression};`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `import(modulePath as string)`,
    `require(modulePath satisfies string)`,
    "import(`${modulePath}/file.js` as string)",
    "require(`${modulePath}/file.js` as string)",
  ])("still reports a dynamic path through %s", (expression) => {
    const result = runRule(
      noDynamicImportPath,
      `const load = (modulePath: string) => ${expression};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
