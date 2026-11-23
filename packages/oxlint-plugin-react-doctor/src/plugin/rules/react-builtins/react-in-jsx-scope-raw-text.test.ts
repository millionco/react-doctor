import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactInJsxScope } from "./react-in-jsx-scope.js";

const compiler = vi.hoisted(() => ({ accepted: true }));
vi.mock("../../utils/has-stock-node-npm-compiler-environment.js", () => ({
  hasStockNodeNpmCompilerEnvironment: () => true,
  hasExpectedNpmLauncher: () => true,
}));
// Isolate source-role tests from the independently verified physical release
// catalogue. The automatic JSX profile is intentionally not accepted here.
vi.mock("../../utils/verify-stock-npm-compiler-snapshot.js", () => ({
  verifyStockNpmCompilerSnapshot: (_root: string, profile: { packages: number }) =>
    compiler.accepted && profile.packages === 1520,
}));

const source = "/* @jsxRuntime classic */\nexport const example = <React.Fragment />;";
const directories: string[] = [];
const fixture = () => {
  const workspace = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-raw-role-")),
  );
  directories.push(workspace);
  const root = path.join(workspace, "app");
  const write = (name: string, contents: string) => {
    const filename = path.join(workspace, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  };
  write(
    "app/package.json",
    JSON.stringify({
      private: true,
      dependencies: { "react-scripts": "5.0.1", react: "^18.2.0", "ui-kit": "file:../ui" },
      scripts: { build: "react-scripts build" },
      browserslist: {
        production: [">0.2%", "not dead", "not op_mini all"],
        development: ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"],
      },
      eslintConfig: {
        extends: ["react-app", "react-app/jest"],
        rules: { "import/no-webpack-loader-syntax": "off" },
        overrides: [
          { files: ["**/examples/*"], rules: { "react/jsx-no-undef": "off", "no-undef": "off" } },
        ],
      },
    }),
  );
  write("app/public/index.html", '<!doctype html><html><body><div id="root"></div></body></html>');
  write(
    "app/src/index.js",
    'import UI from "ui-kit"; export { UI }; export const text = require("!!raw-loader!./example.jsx").default;',
  );
  write("app/src/example.jsx", source);
  write(
    "ui/package.json",
    JSON.stringify({ main: "src/index.js", devDependencies: { "grid-core": "file:../core" } }),
  );
  write("ui/src/index.js", 'import grid from "grid-core"; export default grid;');
  write("core/package.json", JSON.stringify({ main: "src/index.js" }));
  write("core/src/index.js", "export default 1;");
  write("app/node_modules/raw-loader/package.json", '{"name":"raw-loader","version":"4.0.2"}');
  fs.mkdirSync(path.join(workspace, "ui/node_modules"), { recursive: true });
  fs.symlinkSync(path.join(workspace, "ui"), path.join(root, "node_modules/ui-kit"), "junction");
  fs.symlinkSync(
    path.join(workspace, "core"),
    path.join(workspace, "ui/node_modules/grid-core"),
    "junction",
  );
  return {
    workspace,
    root,
    write,
    run: () =>
      runRule(reactInJsxScope, source, {
        filename: path.join(root, "src/example.jsx"),
        settings: { "react-doctor": { rootDirectory: root } },
      }),
  };
};

afterEach(() => {
  compiler.accepted = true;
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("verified compiler input used only as raw text", () => {
  it("does not evaluate JSX or React member tags inside the emitted string", () => {
    const result = fixture().run();
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'import "./example.jsx";',
    'const example = require("./example.jsx");',
    "import(globalThis.selectedModule);",
    'new Worker(new URL("./example.jsx", import.meta.url));',
    'new SharedWorker(new URL("./example.jsx", import.meta.url));',
    'import "ui-kit/src/index.js";',
    'import "raw-loader/../../src/example.jsx";',
  ])("retains normal or opaque runtime ingress: %s", (extra) => {
    const project = fixture();
    const entry = path.join(project.root, "src/index.js");
    fs.appendFileSync(entry, extra);
    expect(project.run().diagnostics).toHaveLength(1);
  });

  it("refuses an unverified compiler release", () => {
    const project = fixture();
    compiler.accepted = false;
    expect(project.run().diagnostics).toHaveLength(1);
  });

  it.each([
    "app/src/node_modules/raw-loader/package.json",
    "ui/node_modules/other-package/package.json",
    "node_modules/raw-loader/package.json",
  ])("refuses an additional physical resolution candidate: %s", (filename) => {
    const project = fixture();
    project.write(filename, '{"name":"other-package","version":"1.0.0"}');
    expect(project.run().diagnostics).toHaveLength(1);
  });

  it("refuses a retargeted local package link", () => {
    const project = fixture();
    const link = path.join(project.root, "node_modules/ui-kit");
    fs.unlinkSync(link);
    fs.symlinkSync(path.join(project.workspace, "core"), link, "junction");
    expect(project.run().diagnostics).toHaveLength(1);
  });

  it("refuses an executable nested linter configuration", () => {
    const project = fixture();
    project.write("app/src/.eslintrc.cjs", "module.exports = {};\n");
    expect(project.run().diagnostics).toHaveLength(1);
  });
});
