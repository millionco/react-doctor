import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const PAGE_SOURCE = `
  import { useState } from "react";
  const caseStudy = () => {
    const [count] = useState(0);
    return <main>{count}</main>;
  };
  export default caseStudy;
`;

let directory: string;

const placeFile = (relativePath: string, source: string): string => {
  const filename = join(directory, relativePath);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, source);
  return filename;
};

const runPage = (source = PAGE_SOURCE) => {
  const filename = placeFile("pages/case-studies/[slug].tsx", source);
  const result = runRule(rulesOfHooks, source, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "rd-next-pages-hooks-"));
  placeFile(
    "package.json",
    JSON.stringify({ dependencies: { next: "12.1.0", react: "17.0.2", "react-dom": "17.0.2" } }),
  );
  placeFile(
    "pages/_app.js",
    `function App({ Component, pageProps }) { return <Component {...pageProps} />; }
     export default App;`,
  );
  resetManifestCaches();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  resetManifestCaches();
});

describe("rules-of-hooks in stock Next.js Pages Router components", () => {
  it("recognizes a lowercase dynamic page through an App that uses JSX in a JS file", () => {
    expect(runPage()).toEqual([]);
  });

  it("reports a Hook after an early return in a recognized page", () => {
    const result = runPage(
      PAGE_SOURCE.replace("const [count]", "if (!ready) return null; const [count]"),
    );
    expect(result).toEqual([
      expect.objectContaining({ message: expect.stringContaining("changes Hook order") }),
    ]);
  });

  it("retains the page warning when an API module directly calls an imported page", () => {
    placeFile(
      "pages/api/build/preview.ts",
      `import * as route from "../../case-studies/[slug]";
       const invoke = route.default;
       export default () => invoke();`,
    );
    expect(runPage()).toEqual([
      expect.objectContaining({ message: expect.stringContaining("is not a component or Hook") }),
    ]);
  });

  it("records the directory and caller for a caller outside the lint selection", () => {
    const filename = placeFile("pages/case-studies/[slug].js", PAGE_SOURCE);
    const caller = placeFile(
      "pages/api/preview.js",
      `import Page from "../case-studies/[slug]";
       export default () => Page();`,
    );
    const dependencies = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: PAGE_SOURCE,
      ruleIds: ["rules-of-hooks"],
    });
    expect(dependencies?.directoryPaths.has(dirname(caller))).toBe(true);
    expect(dependencies?.contentPaths.has(caller)).toBe(true);
  });
});
