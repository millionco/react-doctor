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

vi.mock("../../utils/resolve-verified-stock-kkt-cra-suppliers.js", () => ({
  resolveVerifiedStockKktCraSuppliers: () => {
    const compilerEntry = { entry: "/verified/jsx-runtime.js" };
    return {
      reactJsxRuntime: compilerEntry,
      configSuppliers: new Map([
        ["@kkt/less-modules", compilerEntry],
        ["@kkt/raw-modules", compilerEntry],
        ["markdown-react-code-preview-loader", compilerEntry],
        ["@kkt/scope-plugin-options", compilerEntry],
      ]),
    };
  },
}));

vi.mock("../../utils/read-condition-invariant-cra-jsx-runtime.js", () => ({
  readConditionInvariantCraJsxRuntime: () => ({ entry: "/verified/jsx-runtime.js" }),
}));

const authorConfig = String.raw`
import configWebpack from "webpack";
import styleAdapter from "@kkt/less-modules";
import plainText from "@kkt/raw-modules";
import { mdCodeModulesLoader as examples } from "markdown-react-code-preview-loader";
import { disableScopePlugin as allowPackages } from "@kkt/scope-plugin-options";
import application from "./package.json";

export default (build, phase, settings) => {
  build = styleAdapter(build, phase, settings);
  build = plainText(build, phase, { ...settings, test: /\.txt$/ });
  build = examples(build);
  build = allowPackages(build);
  build.plugins.push(new configWebpack.DefinePlugin({ APP_REVISION: JSON.stringify(application.version) }));
  build.module.exprContextCritical = false;
  build.ignoreWarnings = [{ module: /example-adapter/ }];
  if (phase === "production") {
    build.optimization = { ...build.optimization, splitChunks: { cacheGroups: {
      shared: { name: "shared", test: /shared-ui/, chunks: "all" },
    } } };
    build.output = { ...build.output, publicPath: "./" };
  }
  return build;
};
`;
const implicitSource =
  'import { floor } from "shared-ui"; export const Panel = () => <section>{floor}</section>;';
const projectDirectories: string[] = [];
const subject = "site/src/Panel.tsx";

const fixture = (source = implicitSource, overrides: Readonly<Record<string, string>> = {}) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-stock-kkt-")));
  projectDirectories.push(root);
  const temporaryDirectory = path.join(root, "tmp");
  fs.mkdirSync(temporaryDirectory);
  vi.stubEnv("TMPDIR", temporaryDirectory);
  const files = {
    "package.json": JSON.stringify({ workspaces: ["site", "components/*"] }),
    "site/package.json": JSON.stringify({
      name: "site",
      version: "1.2.3",
      scripts: { build: "kkt build" },
      browserslist: {
        production: [">0.2%", "not dead", "not op_mini all"],
        development: ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"],
      },
    }),
    "site/.kktrc.ts": authorConfig,
    "site/tsconfig.json": JSON.stringify({ compilerOptions: { noEmit: true } }),
    "site/src/index.tsx": 'export { Panel } from "./Panel";',
    [subject]: source,
    "components/shared/package.json": JSON.stringify({
      name: "shared-ui",
      version: "1.0.0",
      module: "./out/index.js",
    }),
    "components/shared/out/index.js": "export const floor = 2;",
    ...overrides,
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.symlinkSync("../components/shared", path.join(root, "node_modules/shared-ui"));
  fs.symlinkSync("../site", path.join(root, "node_modules/site"));
  return {
    filename: path.join(root, subject),
    settings: { "react-doctor": { rootDirectory: path.join(root, "site") } },
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of projectDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("stock KKT TypeScript JSX", () => {
  it("accepts a reached site using its declared npm workspace provider", () => {
    const result = runRule(reactInJsxScope, implicitSource, fixture());
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "DISABLE_NEW_JSX_TRANSFORM",
    "JITI_ALIAS",
    "JITI_CACHE",
    "BROWSERSLIST_CONFIG",
    "BROWSERSLIST_DANGEROUS_EXTEND",
  ])("retains the warning with an unsupported %s setting", (key) => {
    vi.stubEnv(key, key === "JITI_ALIAS" ? "{}" : "true");
    expect(runRule(reactInJsxScope, implicitSource, fixture()).diagnostics).toHaveLength(1);
  });

  it.each<Readonly<Record<string, string>>>([
    { "site/src/index.tsx": "export const Other = () => null;" },
    { "site/.env.production.local": "DISABLE_NEW_JSX_TRANSFORM=true\n" },
    { "site/src/node_modules/shared-ui.js": "export const floor = 3;" },
    { "node_modules/.cache/babel-loader/.keep": "" },
    { "tmp/node-jiti/.keep": "" },
    { "site/.browserslistrc": "last 2 versions" },
    {
      "site/package.json": JSON.stringify({
        name: "site",
        version: "1.2.3",
        scripts: { build: "kkt build" },
        browserslist: ["extends browserslist-config-custom"],
      }),
    },
    { "site/.kktrc.js": "export default (config) => config;" },
    { "site/.kktrc.ts": authorConfig.replace("return build", "return settings") },
  ])("retains the warning for an unsupported compiler or source input", (overrides) => {
    expect(
      runRule(reactInJsxScope, implicitSource, fixture(implicitSource, overrides)).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    "/* @jsxRuntime classic */\nexport const Panel = () => <section />;",
    "export const Panel = () => <React.Fragment />;",
  ])("retains classic pragmas and unbound React tag names", (source) => {
    expect(runRule(reactInJsxScope, source, fixture(source)).diagnostics).toHaveLength(1);
  });
});
