import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

vi.mock("../../utils/has-stock-node-npm-compiler-environment.js", () => ({
  hasStockNodeNpmCompilerEnvironment: () => true,
  hasExpectedNpmLauncher: () => true,
}));

vi.mock("../../utils/verify-stock-npm-compiler-snapshot.js", () => ({
  verifyStockNpmCompilerSnapshot: () => true,
}));

const page = "src/Page.jsx";
const implicitSource = "export default function Page() { return <main />; }";
const directories: string[] = [];

const fixture = (source = implicitSource, overrides: Readonly<Record<string, string>> = {}) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-stock-cra-")));
  directories.push(root);
  const files = {
    "package.json": JSON.stringify({
      dependencies: { "react-scripts": "5.0.1", react: "^18.2.0" },
      scripts: { build: "react-scripts build" },
      browserslist: {
        production: [">0.2%", "not dead", "not op_mini all"],
        development: ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"],
      },
    }),
    "src/index.jsx": 'import Page from "./Page"; export default Page;',
    "public/index.html": '<!doctype html><html><body><div id="root"></div></body></html>',
    [page]: source,
    ...overrides,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  }
  return { filename: path.join(root, page), settings: { "react-doctor": { rootDirectory: root } } };
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of directories.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stock Create React App JSX", () => {
  it("accepts a reached JSX source with the verified default compiler", () => {
    const result = runRule(reactInJsxScope, implicitSource, fixture());
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains classic mode with the documented environment override", () => {
    vi.stubEnv("DISABLE_NEW_JSX_TRANSFORM", "true");
    const result = runRule(reactInJsxScope, implicitSource, fixture());
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each<Readonly<Record<string, string>>>([
    { ".env.production.local": "DISABLE_NEW_JSX_TRANSFORM=true\n" },
    { "src/index.tsx": "export default function Alternate() { return <aside />; }" },
    { "src/index.jsx": 'import Page from "!!./loader.cjs!./Page.jsx"; export default Page;' },
    {
      "src/index.jsx": 'import Page from "./Page"; import "./sibling"; export default Page;',
      "src/sibling.js": 'import wrapper from "./wrapper.macro"; export default wrapper;',
    },
    { "src/index.jsx": "export default function Unrelated() {}" },
    { "src/setupProxy.js": "module.exports = () => {};" },
    { "node_modules/.cache/.keep": "" },
    { "public/index.html": "<% const title = 'custom template'; %>" },
  ])("retains JSX scope warnings for unsupported project inputs", (overrides) => {
    const result = runRule(reactInJsxScope, implicitSource, fixture(implicitSource, overrides));
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "/* @jsxRuntime classic */\nexport default function Page() { return <main />; }",
    "export default function Page() { return <React.Fragment />; }",
    "export default function Page() { return <main>{React.version}</main>; }",
  ])("retains explicit classic or unresolved React usage", (source) => {
    const result = runRule(reactInJsxScope, source, fixture(source));
    expect(result.diagnostics).toHaveLength(1);
  });
});
