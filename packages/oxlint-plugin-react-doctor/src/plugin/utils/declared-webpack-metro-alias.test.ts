import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readDeclaredWebpackMetroAlias } from "./has-declared-webpack-metro-alias.js";
import { readDeclaredMetroPeerAliasDirectory } from "./read-declared-metro-peer-alias-directory.js";

const METRO_CONFIG = `
  const locations = require("node:path");
  const { makeMetroConfig: createConfig } = require("@rnx-kit/metro-config");
  const packageInfo = require("../sprite-kit/package.json");
  const peerNames = Object.keys(packageInfo.peerDependencies);
  module.exports = createConfig({
    resolver: {
      extraNodeModules: peerNames.reduce((result, peerName) => {
        result[peerName] = locations.join(__dirname, "node_modules", peerName);
        return result;
      }, {}),
    },
  });
`;

const WEBPACK_CONFIG = String.raw`
  const locations = require("node:path");
  const sandbox = locations.join(__dirname, ".");
  const { resolver: mobileResolution } = require("./metro.config.js");
  const { presets: syntaxPresets } = require(locations.join(sandbox, "babel.config.js"));
  const importedWidgetSources = ["@fixture/sprite-kit"].map((widgetName) =>
    locations.join(sandbox, "node_modules", widgetName)
  );
  const sourceRule = {
    test: /\.[jt]sx?$/i,
    include: [locations.join(sandbox, "widgets"), ...importedWidgetSources],
    use: {
      loader: "babel-loader",
      options: { presets: syntaxPresets, plugins: ["react-native-web"] },
    },
  };
  module.exports = {
    entry: { showcase: "./index.web.js" },
    resolve: {
      mainFields: ["react-native", "main"],
      extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.js", ".js", ".lottie", ".json"],
      alias: { ...mobileResolution.extraNodeModules, "react-native": "react-native-web" },
      symlinks: false,
      modules: ["node_modules", "src"],
    },
    module: { rules: [sourceRule] },
    plugins: [],
  };
`;

let workspace: string;

const writeFixture = (name: string, text: string): string => {
  const filename = join(workspace, name);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, text, "utf8");
  return filename;
};

const readMetro = (
  source: string,
  peerManifest = join(workspace, "packages", "sprite-kit", "package.json"),
) =>
  readDeclaredMetroPeerAliasDirectory(
    writeFixture("packages/showroom/metro.config.js", source),
    peerManifest,
  );

const readWebpack = (
  source: string,
  aliasDirectory = join(workspace, "packages", "showroom", "node_modules"),
) =>
  readDeclaredWebpackMetroAlias(
    writeFixture("packages/showroom/webpack.config.js", source),
    aliasDirectory,
  );

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "rd-metro-webpack-alias-"));
  writeFixture(
    "packages/sprite-kit/package.json",
    JSON.stringify({ peerDependencies: { "@fixture/driver": "^1.0.0" } }),
  );
  writeFixture("packages/showroom/babel.config.js", "module.exports = { presets: [] };\n");
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("readDeclaredMetroPeerAliasDirectory", () => {
  it("proves an owned peer map through renamed CommonJS bindings", () => {
    expect(readMetro(METRO_CONFIG)).toBe(join(workspace, "packages", "showroom", "node_modules"));
  });

  it("allows inert literals alongside the peer map", () => {
    const config = METRO_CONFIG.replace(
      "resolver: {",
      'transformer: { getTransformOptions: () => ({ transform: { inlineRequires: true } }) },\nresolver: { assetExts: ["wav"],',
    );
    expect(readMetro(config)).toBe(join(workspace, "packages", "showroom", "node_modules"));
  });

  it.each([
    [
      "a different owner manifest",
      METRO_CONFIG.replace("../sprite-kit/package.json", "../theme-kit/package.json"),
    ],
    ["a resolver spread", METRO_CONFIG.replace("resolver: {", "resolver: { ...alternateRules,")],
    [
      "a custom resolver",
      METRO_CONFIG.replace("resolver: {", "resolver: { resolveRequest: customResolve,"),
    ],
    [
      "an alternate directory",
      METRO_CONFIG.replace('"node_modules", peerName', '"vendor", peerName'),
    ],
    ["a different alias key", METRO_CONFIG.replace("result[peerName]", 'result["fixed-name"]')],
    [
      "a mutable path helper",
      METRO_CONFIG.replace("const peerNames", "locations.join = choosePath;\nconst peerNames"),
    ],
  ])("rejects %s", (_name, source) => {
    expect(readMetro(source)).toBeNull();
  });
});

describe("readDeclaredWebpackMetroAlias", () => {
  it("joins the decoded Metro directory to a literal Webpack entry", () => {
    const aliasDirectory = readMetro(METRO_CONFIG);
    expect(aliasDirectory).toBe(join(workspace, "packages", "showroom", "node_modules"));
    if (!aliasDirectory) throw new Error("Expected the Metro test route to resolve");
    expect(readWebpack(WEBPACK_CONFIG, aliasDirectory)).toEqual({
      entryPath: join(workspace, "packages", "showroom", "index.web.js"),
      aliasDirectory,
      htmlTemplate: null,
    });
  });

  it("preserves a literal HTML template path without loading the plugin", () => {
    const config = WEBPACK_CONFIG.replace(
      "const locations",
      'const HtmlShell = require("html-webpack-plugin");\nconst locations',
    ).replace(
      "plugins: [],",
      'plugins: [new HtmlShell({ template: locations.join(sandbox, "pages", "gallery.html") })],',
    );
    expect(readWebpack(config)?.htmlTemplate).toBe(
      join(workspace, "packages", "showroom", "pages", "gallery.html"),
    );
  });

  it.each([
    [
      "an alternate Metro import",
      WEBPACK_CONFIG.replace("./metro.config.js", "./replacement-metro.config.js"),
    ],
    [
      "an extra package alias",
      WEBPACK_CONFIG.replace(
        '"react-native": "react-native-web"',
        '"react-native": "react-native-web", "@fixture/driver": "./replacement.js"',
      ),
    ],
    [
      "an opaque alias spread",
      WEBPACK_CONFIG.replace("...mobileResolution.extraNodeModules", "...selectAliases()"),
    ],
    [
      "a conditional entry",
      WEBPACK_CONFIG.replace(
        'showcase: "./index.web.js"',
        'showcase: useOtherEntry ? "./alternate.js" : "./index.web.js"',
      ),
    ],
    [
      "a different loader",
      WEBPACK_CONFIG.replace('loader: "babel-loader"', 'loader: "./rewrite-imports.js"'),
    ],
    [
      "a custom Babel transform",
      WEBPACK_CONFIG.replace(
        'plugins: ["react-native-web"]',
        'plugins: ["react-native-web", "./rename-package.js"]',
      ),
    ],
    [
      "a different module resolution order",
      WEBPACK_CONFIG.replace(
        'mainFields: ["react-native", "main"]',
        'mainFields: ["main", "react-native"]',
      ),
    ],
    [
      "a package replacement plugin",
      WEBPACK_CONFIG.replace(
        "const locations",
        'const Webpack = require("webpack");\nconst locations',
      ).replace(
        "plugins: [],",
        'plugins: [new Webpack.NormalModuleReplacementPlugin(/driver/, "./substitute.js")],',
      ),
    ],
  ])("rejects %s", (_name, source) => {
    expect(readWebpack(source)).toBeNull();
  });

  it("rejects a decoded Metro directory from a different application", () => {
    expect(readWebpack(WEBPACK_CONFIG, join(workspace, "elsewhere", "node_modules"))).toBeNull();
  });
});
