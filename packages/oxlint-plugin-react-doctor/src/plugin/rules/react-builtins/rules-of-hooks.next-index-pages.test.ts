import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const pageSource = `
  import { useState } from "react";
  const index = () => { const [count] = useState(0); return <main>{count}</main>; };
  export default index;
`;

const stockApp = `
  function App({ Component, pageProps }) {
    return (<main><Component {...pageProps} /></main>);
  }
  export default App;
`;

let projectDirectory: string;

const placeFile = (relativePath: string, source: string): string => {
  const filename = join(projectDirectory, relativePath);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, source);
  return filename;
};

const runPage = (source = pageSource) => {
  const filename = placeFile("pages/index.tsx", source);
  const result = runRule(rulesOfHooks, source, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  projectDirectory = mkdtempSync(join(tmpdir(), "rd-next-index-hooks-"));
  placeFile(
    "package.json",
    JSON.stringify({
      dependencies: { next: "16.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    }),
  );
  resetManifestCaches();
});

afterEach(() => {
  rmSync(projectDirectory, { recursive: true, force: true });
  resetManifestCaches();
});

describe("rules-of-hooks standard Next.js index pages", () => {
  it("recognizes a lowercase default export through a parenthesized custom App", () => {
    placeFile("pages/_app.tsx", stockApp);
    expect(runPage()).toEqual([]);
  });

  it("continues to report a conditional Hook in a recognized page", () => {
    placeFile("pages/_app.tsx", stockApp);
    const diagnostics = runPage(
      pageSource.replace(
        "const [count] = useState(0);",
        "if (!ready) return null; const [count] = useState(0);",
      ),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("changes Hook order");
  });

  it("retains the warning when the page binding is invoked directly", () => {
    placeFile("pages/_app.tsx", stockApp);
    expect(runPage(pageSource + "void index();")).toHaveLength(1);
  });

  it.each([
    ["direct call", "if (pageProps.eager) Component(pageProps);", "Component"],
    ["duplicate binding", "if (pageProps.eager) Alias(pageProps);", "Component, Component: Alias"],
    [
      "computed binding",
      "if (pageProps.eager) Alias(pageProps);",
      'Component, ["Component"]: Alias',
    ],
    ["argument alias", "if (pageProps.eager) arguments[0].Component(pageProps);", "Component"],
  ])("retains the warning for a custom App %s", (_label, invocation, parameter) => {
    placeFile(
      "pages/_app.tsx",
      stockApp.replace(
        "function App({ Component, pageProps }) {",
        `function App({ ${parameter}, pageProps }) { ${invocation}`,
      ),
    );
    expect(runPage()).toHaveLength(1);
  });

  it("retains the warning when a local App import can invoke the page", () => {
    placeFile(
      "pages/_app.tsx",
      'import page from "./index";' +
        stockApp.replace("return (<main>", "if (pageProps.eager) page(); return (<main>"),
    );
    expect(runPage()).toHaveLength(1);
  });

  it("retains the warning when an App import resolves through a local package", () => {
    placeFile(
      "package.json",
      JSON.stringify({
        dependencies: {
          next: "16.0.0",
          react: "19.0.0",
          "react-dom": "19.0.0",
          "local-invoker": "file:./invoker",
        },
      }),
    );
    placeFile(
      "pages/_app.tsx",
      'import { invoke } from "local-invoker";' +
        stockApp.replace("return (<main>", "if (pageProps.eager) invoke(); return (<main>"),
    );
    expect(runPage()).toHaveLength(1);
  });

  it("retains the warning when an App import can resolve to its own package", () => {
    placeFile(
      "package.json",
      JSON.stringify({
        name: "example-app",
        exports: { "./invoke": "./invoke.js" },
        dependencies: {
          next: "16.0.0",
          react: "19.0.0",
          "react-dom": "19.0.0",
          "example-app": "1.0.0",
        },
      }),
    );
    placeFile(
      "pages/_app.tsx",
      'import { invoke } from "example-app/invoke";' +
        stockApp.replace("return (<main>", "if (pageProps.eager) invoke(); return (<main>"),
    );
    expect(runPage()).toHaveLength(1);
  });

  it("retains the warning for an unverified wrapper with the same export name", () => {
    placeFile(
      "node_modules/framer-motion/package.json",
      JSON.stringify({
        name: "framer-motion",
        version: "10.16.4",
        main: "./index.js",
      }),
    );
    placeFile(
      "node_modules/framer-motion/index.js",
      `
      exports.AnimatePresence = ({ children }) => children.type(children.props);
    `,
    );
    placeFile(
      "pages/_app.tsx",
      'import { AnimatePresence } from "framer-motion";' +
        stockApp.replace(
          "<main><Component {...pageProps} /></main>",
          '<AnimatePresence mode="wait"><Component {...pageProps} /></AnimatePresence>',
        ),
    );
    expect(runPage()).toHaveLength(1);
  });

  it("keeps the report with an alternate renderer or duplicate route", () => {
    placeFile("pages/_app.tsx", stockApp);
    placeFile("pages/_document.tsx", "export default function Document() { return <main />; }");
    expect(runPage()).toHaveLength(1);
    rmSync(join(projectDirectory, "pages/_document.tsx"));
    placeFile("pages/index.jsx", "export default function Index() { return <main />; }");
    expect(runPage()).toHaveLength(1);
  });

  it("tracks the App, config and alternative route inputs for cache invalidation", () => {
    const app = placeFile("pages/_app.tsx", stockApp);
    const page = placeFile("pages/index.tsx", pageSource);
    const probes = collectCrossFileDependencyProbes({
      absoluteFilePath: page,
      sourceText: pageSource,
      ruleIds: ["rules-of-hooks"],
    });
    expect(probes?.contentPaths.has(app)).toBe(true);
    expect(probes?.contentPaths.has(join(projectDirectory, "package.json"))).toBe(true);
    expect(probes?.existencePaths.has(join(projectDirectory, "next.config.js"))).toBe(true);
    expect(probes?.existencePaths.has(join(projectDirectory, "tsconfig.json"))).toBe(true);
    expect(probes?.existencePaths.has(join(projectDirectory, "pages/_document.tsx"))).toBe(true);
    expect(probes?.existencePaths.has(join(projectDirectory, "pages/index.jsx"))).toBe(true);
  });
});
