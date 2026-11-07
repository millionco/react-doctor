import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { discoverProject } from "../src/project-info/discover-project.js";
import { runOxlint } from "../src/run-oxlint.js";
import { parseSourceText } from "../../oxlint-plugin-react-doctor/src/plugin/utils/parse-source-file.js";
import { noArrayIndexAsKey } from "../../oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-array-index-as-key.js";

interface WebpackSnapshotMutation {
  readonly filename: string;
  readonly before: string;
  readonly after: string;
}

interface WebpackSnapshotManifestOptions {
  readonly build?: string;
  readonly routerVersion?: string;
}

const WEBPACK_SNAPSHOT_MANIFEST = {
  name: "closed-snapshot-viewer",
  private: true,
  scripts: {
    build: "NODE_ENV=production BABEL_ENV=production webpack --config ./build/production.js",
  },
  dependencies: {
    react: "16.14.0",
    "react-dom": "16.14.0",
    "react-router-dom": "5.1.2",
    axios: "0.17.1",
    antd: "3.26.0",
  },
  devDependencies: {
    webpack: "3.12.0",
    "webpack-merge": "4.2.1",
    "html-webpack-plugin": "2.30.1",
    "babel-core": "6.26.3",
    "babel-loader": "7.1.5",
    "babel-preset-env": "1.7.0",
    "babel-preset-react": "6.24.1",
    "babel-plugin-transform-class-properties": "6.24.1",
    "babel-plugin-transform-object-rest-spread": "6.26.0",
    "babel-plugin-transform-runtime": "6.23.0",
    "babel-plugin-import": "1.12.0",
  },
};

const WEBPACK_SNAPSHOT_BABEL = {
  presets: [["env", { modules: false }], "react"],
  plugins: [
    "transform-class-properties",
    "transform-object-rest-spread",
    [
      "transform-runtime",
      { helpers: false, polyfill: false, regenerator: true, moduleName: "babel-runtime" },
    ],
    ["import", { libraryName: "antd", libraryDirectory: "lib", style: false }],
  ],
};

const WEBPACK_SNAPSHOT_FILES: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify(WEBPACK_SNAPSHOT_MANIFEST),
  ".babelrc": JSON.stringify(WEBPACK_SNAPSHOT_BABEL),
  "build/base.js": `
    const path = require("path");
    module.exports = {
      output: { path: path.resolve(__dirname, "../dist"), filename: "[name].js", publicPath: "/" },
      resolve: {
        alias: { "@": path.resolve(__dirname, "../src") },
        extensions: [".js", ".jsx", ".json"]
      },
      module: {
        rules: [{ test: /\\.jsx?$/, include: path.resolve(__dirname, "../src"), exclude: /node_modules/, use: { loader: "babel-loader" } }]
      }
    };
  `,
  "build/entries.js": `
    const path = require("path");
    const HtmlWebpackPlugin = require("html-webpack-plugin");
    module.exports = {
      entry: { index: path.resolve(__dirname, "../src/index.js") },
      plugins: [new HtmlWebpackPlugin({
        template: path.resolve(__dirname, "../public/index.html"),
        filename: "index.html", inject: true, title: "Snapshot reader"
      })]
    };
  `,
  "build/production.js": `
    const path = require("path");
    const merge = require("webpack-merge");
    const webpack = require("webpack");
    const base = require("./base");
    const entries = require("./entries");
    module.exports = merge(base, entries, {
      plugins: [new webpack.DefinePlugin({ "process.env.NODE_ENV": '"production"' })]
    });
  `,
  "public/index.html":
    '<!doctype html><html><head><title><%= htmlWebpackPlugin.options.title %></title></head><body><div id="root"></div></body></html>',
  "src/request.js": `
    import axios from "axios";
    export const loadSettings = () => new Promise((resolve, reject) => {
      axios({ method: "get", url: "/content", responseType: "json" })
        .then(response => resolve(response.data))
        .catch(reject);
    });
  `,
  "src/shell.js": `
    import React, { useEffect, useState } from "react";
    import { BrowserRouter, Route } from "react-router-dom";
    import { loadSettings } from "@/request";
    import Reader from "./reader";
    export default function Shell() {
      const [settings, setSettings] = useState({});
      useEffect(() => {
        loadSettings().then(packet => {
          if (packet.code === 0) setSettings(packet.data);
        });
      }, []);
      if (Object.keys(settings).length === 0) return null;
      return <BrowserRouter><Route path="/" render={routeProps => <Reader {...routeProps} {...settings} />} /></BrowserRouter>;
    }
  `,
  "src/reader.js": `
    import React from "react";
    export default function Reader(props) {
      return <section>{props.paragraphs.map((paragraph, index) => <p key={index}>{index + 1}. {paragraph}</p>)}</section>;
    }
  `,
  "src/boundary.js": `
    import React from "react";
    class Boundary extends React.Component {
      state = { hasError: false };
      static getDerivedStateFromError() { return { hasError: true }; }
      componentDidCatch(error, info) { console.error(error, info); }
      render() {
        if (this.state.hasError) return <p>Unable to load this view.</p>;
        return this.props.children;
      }
    }
    export default Boundary;
  `,
  "src/index.js": `
    import React from "react";
    import ReactDOM from "react-dom";
    import { LocaleProvider } from "antd";
    import enUS from "antd/lib/locale-provider/en_US";
    import Boundary from "./boundary";
    import Shell from "./shell";
    ReactDOM.render(<LocaleProvider locale={enUS}><Boundary><Shell /></Boundary></LocaleProvider>, document.getElementById("root"));
  `,
};

let webpackFixtureDirectory: string;
let webpackCacheHitFileCount = 0;

const writeWebpackSnapshotFile = (filename: string, sourceText: string): void => {
  const absolutePath = path.join(webpackFixtureDirectory, filename);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, sourceText);
};

const replaceWebpackSnapshotSource = ({
  filename,
  before,
  after,
}: WebpackSnapshotMutation): void => {
  const sourceText = fs.readFileSync(path.join(webpackFixtureDirectory, filename), "utf8");
  expect(sourceText).toContain(before);
  writeWebpackSnapshotFile(filename, sourceText.replace(before, after));
};

const assertWebpackSnapshotSourcesParse = (): void => {
  const visitDirectory = (relativeDirectory: string): void => {
    for (const directoryEntry of fs.readdirSync(
      path.join(webpackFixtureDirectory, relativeDirectory),
      { withFileTypes: true },
    )) {
      const relativePath = path.join(relativeDirectory, directoryEntry.name);
      if (directoryEntry.isDirectory()) visitDirectory(relativePath);
      else if (/\.[cm]?[jt]sx?$/.test(directoryEntry.name)) {
        const filename = path.join(webpackFixtureDirectory, relativePath);
        expect(
          parseSourceText({
            filename,
            sourceText: fs.readFileSync(filename, "utf8"),
            language: directoryEntry.name.endsWith(".js") ? "jsx" : undefined,
          }),
          relativePath,
        ).not.toBeNull();
      }
    }
  };
  visitDirectory("src");
  if (fs.existsSync(path.join(webpackFixtureDirectory, "build"))) visitDirectory("build");
};

const runWebpackSnapshotReader = (readerRelativePath = "src/reader.js") => {
  assertWebpackSnapshotSourcesParse();
  const filename = path.join(webpackFixtureDirectory, readerRelativePath);
  const result = runRule(noArrayIndexAsKey, fs.readFileSync(filename, "utf8"), {
    filename,
    forceJsx: true,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

const runNativeWebpackSnapshotReader = async (
  cacheEnabled = false,
  readerRelativePath = "src/reader.js",
) => {
  assertWebpackSnapshotSourcesParse();
  const partialFailures: string[] = [];
  let didReportCacheStats = false;
  const diagnostics = await runOxlint({
    rootDirectory: webpackFixtureDirectory,
    project: discoverProject(webpackFixtureDirectory),
    includePaths: [readerRelativePath],
    customRulesOnly: true,
    userConfig: { rules: { "react-doctor/no-array-index-as-key": "warn" } },
    perFileLintCacheEnabled: cacheEnabled,
    sidecarLintCacheEnabled: cacheEnabled,
    onCacheStats: (cacheHitFileCount) => {
      didReportCacheStats = true;
      webpackCacheHitFileCount = cacheHitFileCount;
    },
    onPartialFailure: (reason) => partialFailures.push(reason),
  });
  expect(partialFailures).toEqual([]);
  if (cacheEnabled) expect(didReportCacheStats).toBe(true);
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.rule === "no-array-index-as-key" &&
      diagnostic.filePath.replaceAll("\\", "/") === readerRelativePath,
  );
};

const addWebpackAxiosResolution = (version: string): void => {
  const manifest = {
    ...WEBPACK_SNAPSHOT_MANIFEST,
    dependencies: { ...WEBPACK_SNAPSHOT_MANIFEST.dependencies, axios: "^0.17.0" },
  };
  writeWebpackSnapshotFile("package.json", JSON.stringify(manifest));
  writeWebpackSnapshotFile(
    "yarn.lock",
    `# yarn lockfile v1\n\n"axios@^0.17.0":\n  version "${version}"\n  resolved "https://registry.yarnpkg.com/axios/-/axios-${version}.tgz#0123456789abcdef0123456789abcdef01234567"\n`,
  );
};

const writeWebpackSnapshotManifest = ({
  build = WEBPACK_SNAPSHOT_MANIFEST.scripts.build,
  routerVersion = WEBPACK_SNAPSHOT_MANIFEST.dependencies["react-router-dom"],
}: WebpackSnapshotManifestOptions): void => {
  writeWebpackSnapshotFile(
    "package.json",
    JSON.stringify({
      ...WEBPACK_SNAPSHOT_MANIFEST,
      scripts: { build },
      dependencies: {
        ...WEBPACK_SNAPSHOT_MANIFEST.dependencies,
        "react-router-dom": routerVersion,
      },
    }),
  );
};

beforeEach(() => {
  webpackFixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-webpack-json-snapshot-"));
  webpackCacheHitFileCount = 0;
  for (const [filename, sourceText] of Object.entries(WEBPACK_SNAPSHOT_FILES))
    writeWebpackSnapshotFile(filename, sourceText);
});

afterEach(() => {
  fs.rmSync(webpackFixtureDirectory, { recursive: true, force: true });
});

describe("source-projected imported JSON snapshot certificate", () => {
  it("certifies an exact native JSON client through the imported source topology", () => {
    expect(runWebpackSnapshotReader()).toEqual([]);
  });

  it("certifies the imported source topology in the actual engine", async () => {
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("does not attest renderer result retention above the owning cell", () => {
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: "ReactDOM.render(",
      after: "const rootInstance = ReactDOM.render(",
    });
    const entrySource = fs.readFileSync(path.join(webpackFixtureDirectory, "src/index.js"), "utf8");
    writeWebpackSnapshotFile("src/index.js", `${entrySource}\npublish(rootInstance);`);
    expect(runWebpackSnapshotReader()).toEqual([]);
  });

  it("keeps same-basename sibling modules separate from the certified reader", () => {
    writeWebpackSnapshotFile(
      "src/other/reader.js",
      'import React from "react"; export default function Reader() { return <p>Another module</p>; }',
    );
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: 'import Shell from "./shell";',
      after: 'import Shell from "./shell"; import OtherReader from "./other/reader";',
    });
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: "<Shell />",
      after: "<main><OtherReader data={runtimeData} /><Shell /></main>",
    });
    expect(runWebpackSnapshotReader()).toEqual([]);
  });

  it("honors a later merge alias override that selects an opaque provider", () => {
    writeWebpackSnapshotFile(
      "src/alternate/request.js",
      "export const loadSettings = () => Promise.resolve(runtimeSettings);",
    );
    replaceWebpackSnapshotSource({
      filename: "build/production.js",
      before: "plugins: [",
      after: 'resolve: { alias: { "@": path.resolve(__dirname, "../src/alternate") } }, plugins: [',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
  });

  it("honors a later safe alias override instead of selecting an unsafe same-basename provider", () => {
    writeWebpackSnapshotFile(
      "src/alternate/request.js",
      WEBPACK_SNAPSHOT_FILES["src/request.js"] ?? "",
    );
    writeWebpackSnapshotFile(
      "src/request.js",
      "export const loadSettings = () => Promise.resolve(runtimeSettings);",
    );
    replaceWebpackSnapshotSource({
      filename: "build/production.js",
      before: "plugins: [",
      after: 'resolve: { alias: { "@": path.resolve(__dirname, "../src/alternate") } }, plugins: [',
    });
    expect(runWebpackSnapshotReader()).toEqual([]);
  });

  it("rejects a package-source client writer without relying on entry reachability", () => {
    writeWebpackSnapshotFile(
      "src/dormant-writer.js",
      'import axios from "axios"; axios.defaults.transformResponse = [customDecoder];',
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: 'import React from "react";',
      after: 'import React from "react"; import "./dormant-writer";',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refreshes the whole-package writer closure across actual warm-cache scans", async () => {
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(webpackCacheHitFileCount).toBeGreaterThan(0);
    writeWebpackSnapshotFile(
      "src/dormant-writer.js",
      'import axios from "axios"; axios.defaults.transformResponse = [customDecoder];',
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
  });

  it("rejects a custom transform for the exact old native-client role", () => {
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'responseType: "json"',
      after: 'responseType: "json", transformResponse: [customDecoder]',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
  });

  it("requires a genuine applicable exact lock selection for an old broad client declaration", () => {
    addWebpackAxiosResolution("0.17.1");
    expect(runWebpackSnapshotReader()).toEqual([]);
    addWebpackAxiosResolution("0.17.2");
    expect(runWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refreshes the exact old client role after a lock change under real cache hits", async () => {
    addWebpackAxiosResolution("0.17.1");
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(webpackCacheHitFileCount).toBeGreaterThan(0);
    addWebpackAxiosResolution("0.17.2");
    expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
  });

  it("refuses a shadow of the authored-source intrinsic Reflect binding", () => {
    replaceWebpackSnapshotSource({
      filename: "src/reader.js",
      before: 'import React from "react";',
      after: 'import React from "react"; const Reflect = custom;',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refuses a shadow of the authored-source intrinsic Function binding", () => {
    replaceWebpackSnapshotSource({
      filename: "src/reader.js",
      before: 'import React from "react";',
      after: 'import React from "react"; const Function = custom;',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rechecks compiler alias configuration without changing the reader", async () => {
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(webpackCacheHitFileCount).toBeGreaterThan(0);
    replaceWebpackSnapshotSource({
      filename: "build/base.js",
      before: '"../src") },',
      after: '"../unresolved-src") },',
    });
    expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
  });
});

describe("source semantic router roles", () => {
  it("certifies the exact reviewed router4 role", async () => {
    writeWebpackSnapshotManifest({ routerVersion: "4.3.1" });
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it.each(["4.3.0", "4.3.2", "4.2.2"])(
    "refuses unsupported routerDOM %s",
    async (routerVersion) => {
      writeWebpackSnapshotManifest({ routerVersion });
      expect(runWebpackSnapshotReader()).toHaveLength(1);
      expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
    },
  );

  it.each(["4.3.1", "5.1.2"])(
    "refuses a local history decoder supplier under routerDOM %s",
    async (routerVersion) => {
      writeWebpackSnapshotManifest({ routerVersion });
      expect(runWebpackSnapshotReader()).toEqual([]);
      expect(await runNativeWebpackSnapshotReader()).toEqual([]);
      writeWebpackSnapshotFile(
        "src/history-override/index.js",
        'import axios from "axios"; axios.defaults.transformResponse = [decode]; export const createBrowserHistory = () => ({});',
      );
      writeWebpackSnapshotFile(
        "src/history-override/createBrowserHistory.js",
        'export {createBrowserHistory as default} from "./index";',
      );
      replaceWebpackSnapshotSource({
        filename: "build/base.js",
        before: 'alias: { "@": path.resolve(__dirname, "../src") }',
        after: 'alias: { "history": path.resolve(__dirname, "../src/history-override") }',
      });
      replaceWebpackSnapshotSource({
        filename: "src/shell.js",
        before: 'from "@/request"',
        after: 'from "./request"',
      });
      expect(runWebpackSnapshotReader()).toHaveLength(1);
      expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
    },
  );
});

describe("source-level fixed-slot imported JSON snapshot projection", () => {
  it("projects source resolution while compiler, asset, stylesheet and HTML data stay opaque", async () => {
    writeWebpackSnapshotManifest({
      build: "opaque-launch --config ./build/production.js --unreviewed && do-not-run",
    });
    replaceWebpackSnapshotSource({
      filename: "build/base.js",
      before: 'const path = require("path");',
      after:
        'const path = require("path"); const unusedCleanup = require("clean-webpack-plugin"); const unusedPostcss = require("postcss-pxtorem"); const UglifyPlugin = require("uglifyjs-webpack-plugin");',
    });
    replaceWebpackSnapshotSource({
      filename: "build/base.js",
      before:
        'output: { path: path.resolve(__dirname, "../dist"), filename: "[name].js", publicPath: "/" },',
      after:
        'output: { path: path.resolve(__dirname, "../../artifacts"), filename: arbitraryOutput(), publicPath: opaquePublicPath }, plugins: [new UglifyPlugin()],',
    });
    replaceWebpackSnapshotSource({
      filename: "build/base.js",
      before: "rules: [{ test:",
      after:
        'rules: [{ test: /\\.less$/, use: [{loader: "css-loader"}, {loader: "less-loader", options: {javascriptEnabled: true}}] }, {test: /\\.png$/, loader: "url-loader", options: {limit: 8}}, { test:',
    });
    writeWebpackSnapshotFile("src/screen.less", ".row { color: rebeccapurple; }");
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "import React,",
      after: 'import "./screen.less"; import React,',
    });
    writeWebpackSnapshotFile(".babelrc", JSON.stringify({ plugins: ["unreviewed-transform"] }));
    writeWebpackSnapshotFile(
      "public/index.html",
      '<script>JSON.parse = externalDecoder;</script><div id="root"></div>',
    );
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("ends the owning-cell proof above the owner instead of requiring a root mount", async () => {
    writeWebpackSnapshotFile(
      "src/index.js",
      'import React from "react"; import Shell from "./shell"; export const Preview = () => <Shell arbitrary={runtimeData} />;',
    );
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("rejects alternating two independently fixed state cells into one receiver slot", async () => {
    writeWebpackSnapshotFile(
      "src/other-request.js",
      WEBPACK_SNAPSHOT_FILES["src/request.js"]!.replace("loadSettings", "loadOtherSettings"),
    );
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: 'import { loadSettings } from "@/request";',
      after:
        'import { loadSettings } from "@/request"; import { loadOtherSettings } from "@/other-request";',
    });
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "function Shell()",
      after: "function Shell(props)",
    });
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "const [settings, setSettings] = useState({});",
      after:
        "const [settings, setSettings] = useState({}); const [otherSettings, setOtherSettings] = useState({});",
    });
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "if (Object.keys(settings).length === 0) return null;",
      after:
        "useEffect(() => { loadOtherSettings().then(packet => { if (packet.code === 0) setOtherSettings(packet.data); }); }, []); if (Object.keys(settings).length === 0) return null; if (Object.keys(otherSettings).length === 0) return null;",
    });
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "{...settings}",
      after: "{...(props.alternate ? settings : otherSettings)}",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects a conditional hook-slot shift even when both paths have equal hook counts", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "function Shell()",
      after: "function Shell(props)",
    });
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "const [settings, setSettings] = useState({});",
      after:
        "if (props.flip) useState(0); const [settings, setSettings] = useState({}); if (!props.flip) useState(0);",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects a getter-hidden hook-slot shift with equal hook counts", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "function Shell()",
      after: "function Shell(props)",
    });
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "const [settings, setSettings] = useState({});",
      after:
        "const hookBox = {get extra() { useState(0); return 0; }}; if (props.flip) hookBox.extra; const [settings, setSettings] = useState({}); if (!props.flip) hookBox.extra;",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects an opaque getter read before the target hook slot", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "export default function Shell()",
      after:
        "const external = {get flag() { if (runtimeFlag) useState(0); return true; }}; export default function Shell()",
    });
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "const [settings, setSettings] = useState({});",
      after: "external.flag; const [settings, setSettings] = useState({});",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects repopulation when the source effect has no stable dependency list", async () => {
    replaceWebpackSnapshotSource({ filename: "src/shell.js", before: "}, []);", after: "});" });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects publication of the state setter through a containing record", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "if (Object.keys(settings).length === 0) return null;",
      after:
        "const setters = {setSettings}; publish(setters); if (Object.keys(settings).length === 0) return null;",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects publication of the selected receiver", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "if (Object.keys(settings).length === 0) return null;",
      after: "publish(settings); if (Object.keys(settings).length === 0) return null;",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects filtering before the ordinal map", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/reader.js",
      before: "props.paragraphs.map",
      after:
        "props.paragraphs.filter(paragraph => props.location.pathname.includes(paragraph)).map",
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects flattening independently keyed maps into one key namespace", async () => {
    writeWebpackSnapshotFile(
      "src/reader.js",
      `import React from "react"; export default function Reader(props) { return <section>{[...props.paragraphs.map((paragraph,index) => <p key={index}>{index + 1}. {paragraph}</p>), ...props.otherParagraphs.map((paragraph,index) => <p key={index}>{index + 1}. {paragraph}</p>)]}</section>; }`,
    );
    expect(runWebpackSnapshotReader()).toHaveLength(2);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(2);
  });

  it.each([
    {
      title: "conditional extra population",
      filename: "src/shell.js",
      before: "if (Object.keys(settings).length === 0) return null;",
      after:
        "if (module.hot) setSettings({paragraphs: []}); if (Object.keys(settings).length === 0) return null;",
    },
    {
      title: "conditional selected-array mutation",
      filename: "src/reader.js",
      before: "return <section>",
      after: "if (module.hot) props.paragraphs.reverse(); return <section>",
    },
    {
      title: "conditional native JSON decoder write",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; if (module.hot) JSON.parse = foreignDecoder;',
    },
  ])("retains the real source contradiction for $title", async (mutation) => {
    replaceWebpackSnapshotSource(mutation);
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("folds a literal false branch without assuming a production HMR condition", async () => {
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; if (false) JSON.parse = foreignDecoder;',
    });
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });
});

describe("source capability escapes retained from historical deployment fixtures", () => {
  it.each([
    {
      title: "published helper Promise with public fulfilled-value mutation",
      filename: "src/shell.js",
      before: "loadSettings().then(packet => {",
      after:
        "const pending = loadSettings(); publish(pending); pending.then(packet => { pending._v.data.paragraphs.reverse();",
    },
    {
      title: "published helper Promise reaction callback",
      filename: "src/shell.js",
      before: "loadSettings().then(packet => {",
      after: "loadSettings().then(expose(packet => {",
      trailingBefore: "});\n      }, []);",
      trailingAfter: "}));\n      }, []);",
    },
    {
      title: "published executor resolver",
      filename: "src/request.js",
      before: "new Promise((resolve, reject) => {",
      after: "new Promise((resolve, reject) => { publish(resolve);",
    },
    {
      title: "published executor rejection capability",
      filename: "src/request.js",
      before: "new Promise((resolve, reject) => {",
      after: "new Promise((resolve, reject) => { publish(reject);",
    },
    {
      title: "published Axios Promise",
      filename: "src/request.js",
      before: 'axios({ method: "get", url: "/content", responseType: "json" })',
      after:
        'const responsePromise = axios({ method: "get", url: "/content", responseType: "json" }); publish(responsePromise); responsePromise',
    },
    {
      title: "published Axios response value",
      filename: "src/request.js",
      before: ".then(response => resolve(response.data))",
      after: ".then(response => { publish(response); resolve(response.data); })",
    },
    {
      title: "response data forwarded to an opaque rejection callback",
      filename: "src/request.js",
      before: ".catch(reject)",
      after: ".catch(response => reject(response.data))",
    },
    {
      title: "injected helper callback",
      filename: "src/request.js",
      before: "loadSettings = () =>",
      after: "loadSettings = callback =>",
      trailingBefore: "resolve(response.data)",
      trailingAfter: "resolve(callback(response.data))",
    },
    {
      title: "Promise species customization",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; Promise[Symbol.species] = customPromise;',
    },
    {
      title: "Promise prototype reaction replacement",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; Promise.prototype.then = customThen;',
    },
    {
      title: "bound bootstrap import exposes SDK capabilities",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import bootstrap from "babel-polyfill"; import axios from "axios";',
    },
  ])("refuses $title with parsed source in the actual engine", async (mutation) => {
    replaceWebpackSnapshotSource(mutation);
    if (mutation.trailingBefore && mutation.trailingAfter)
      replaceWebpackSnapshotSource({
        filename: mutation.filename,
        before: mutation.trailingBefore,
        after: mutation.trailingAfter,
      });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("revokes a cached unchanged leaf after helper Promise publication", async () => {
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(webpackCacheHitFileCount).toBeGreaterThan(0);
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: "loadSettings().then(packet => {",
      after: "const pending = loadSettings(); publish(pending); pending.then(packet => {",
    });
    expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
  });

  it.each([
    {
      title: "registration-global property writer",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; window.__REACT_HOT_LOADER__ = customRegistry;',
    },
    {
      title: "development hot runtime import",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import "react-hot-loader/patch"; import axios from "axios";',
    },
    {
      title: "inactive development hot runtime require",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; if (module.hot) { require("react-hot-loader/patch"); }',
    },
  ])("refuses $title in the complete parsed topology and actual engine", async (mutation) => {
    replaceWebpackSnapshotSource(mutation);
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it.each([
    {
      title: "source access to the shared chunk registration capability",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; webpackJsonp([], {}, []);',
    },
    {
      title: "source access to the shared module cache capability",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; publish(__webpack_require__.c);',
    },
    {
      title: "source replacement of the generated export namespace helper",
      filename: "src/request.js",
      before: ".catch(reject);\n    });",
      after: ".catch(reject);\n    });\n    __webpack_exports__.loadSettings = foreignLoader;",
    },
    {
      title: "top-level declaration shadowing the injected webpack loader argument",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; function __webpack_require__() { return foreign; }',
    },
    {
      title: "source write to the shared runtime public path",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; __webpack_public_path__ = "/other/";',
    },
  ])("refuses $title in the complete parsed topology and actual engine", async (mutation) => {
    replaceWebpackSnapshotSource(mutation);
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refuses JSONP factory injection that reaches the cached client decoder", async () => {
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: `import axios from "axios";
        webpackJsonp([], {913: function(module, exports, loader) {
          Object.values(loader.c).forEach(record => {
            if (record.exports && record.exports.defaults)
              record.exports.defaults.transformResponse = [decode];
          });
        }}, [913]);`,
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("closes a source module-cache escape without a vendor entry", async () => {
    writeWebpackSnapshotFile(
      "build/entries.js",
      `
      const path = require("path");
      const HtmlWebpackPlugin = require("html-webpack-plugin");
      module.exports = {
        entry: { screen: ["babel-polyfill", "console-polyfill", "raf/polyfill", path.resolve(__dirname, "../src/index.js")] },
        plugins: [new HtmlWebpackPlugin({
          template: path.resolve(__dirname, "../public/index.html"), filename: "index.html", inject: true, title: "Snapshot reader"
        })]
      };
    `,
    );
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; publish(__webpack_require__.c);',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refuses an AMD factory in an imported plain script that reaches the client decoder", async () => {
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    writeWebpackSnapshotFile(
      "src/amd-probe.js",
      `
      define(["require"], function(loader) {
        Object.values(loader.c).forEach(record => {
          if (record.exports && record.exports.defaults)
            record.exports.defaults.transformResponse = [decode];
        });
      });
    `,
    );
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: 'import Shell from "./shell";',
      after: 'import Shell from "./shell"; import "./amd-probe";',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refuses System.import reaching an otherwise dormant local decoder writer", async () => {
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    writeWebpackSnapshotFile(
      "src/dormant-writer.js",
      'import axios from "axios"; axios.defaults.transformResponse = [decode];',
    );
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; System.import("./dormant-writer");',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("closes a source module-cache escape with relative imports", async () => {
    fs.rmSync(path.join(webpackFixtureDirectory, "build"), { recursive: true, force: true });
    fs.rmSync(path.join(webpackFixtureDirectory, ".babelrc"));
    fs.rmSync(path.join(webpackFixtureDirectory, "yarn.lock"), { force: true });
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({
        name: "closed-runtime-viewer",
        private: true,
        scripts: { build: "react-scripts build" },
        dependencies: {
          react: "16.14.0",
          "react-dom": "16.14.0",
          "react-router-dom": "5.1.2",
          axios: "0.17.1",
          antd: "3.26.0",
          "react-scripts": "3.4.1",
        },
      }),
    );
    writeWebpackSnapshotFile(
      "public/index.html",
      '<!doctype html><html><head><title>Snapshot viewer</title></head><body><div id="root"></div></body></html>',
    );
    replaceWebpackSnapshotSource({
      filename: "src/shell.js",
      before: 'from "@/request"',
      after: 'from "./request"',
    });
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; publish(__webpack_require__.c);',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refuses a plain-module arguments escape to the webpack loader cache", async () => {
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    writeWebpackSnapshotFile(
      "src/wrapper-probe.js",
      `
      Object.values(arguments['2'].c).forEach(record => {
        if (record.exports && record.exports.defaults)
          record.exports.defaults.transformResponse = [decode];
      });
    `,
    );
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: 'import Shell from "./shell";',
      after: 'import Shell from "./shell"; import "./wrapper-probe";',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("refuses caller reflection from a plain module into the webpack loader cache", async () => {
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    writeWebpackSnapshotFile(
      "src/reflective-probe.js",
      `
      function obtain() { return obtain.caller.arguments['2']; }
      const loader = obtain();
      Object.values(loader.c).forEach(record => {
        if (record.exports && record.exports.defaults)
          record.exports.defaults.transformResponse = [decode];
      });
    `,
    );
    replaceWebpackSnapshotSource({
      filename: "src/index.js",
      before: 'import Shell from "./shell";',
      after: 'import Shell from "./shell"; import "./reflective-probe";',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });
});

describe("known package entries exposing the selected receiver", () => {
  it.each([
    { title: "a direct main entry", metadata: { main: "./src/reader.js" } },
    { title: "an extensionless main entry", metadata: { main: "./src/reader" } },
    { title: "a string export", metadata: { exports: "./src/reader.js" } },
    { title: "a wildcard export", metadata: { exports: { "./*": "./src/*.js" } } },
    { title: "a conditional export", metadata: { exports: { import: "./src/reader.js" } } },
    { title: "a subpath export", metadata: { exports: { "./reader": "./src/reader.js" } } },
    { title: "an export fallback array", metadata: { exports: ["./src/reader.js"] } },
  ])("rejects $title to the selected receiver", async ({ metadata }) => {
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({ ...WEBPACK_SNAPSHOT_MANIFEST, ...metadata }),
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("allows a known public entry disjoint from the selected receiver", async () => {
    writeWebpackSnapshotFile("src/public.js", 'export const heading = "Published heading";');
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({
        ...WEBPACK_SNAPSHOT_MANIFEST,
        main: "./src/public.js",
        exports: { ".": { import: "./src/public.js" } },
      }),
    );
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("refreshes a known receiver entry addition and deletion under real cache hits", async () => {
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(webpackCacheHitFileCount).toBeGreaterThan(0);
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({ ...WEBPACK_SNAPSHOT_MANIFEST, main: "./src/reader.js" }),
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
    writeWebpackSnapshotFile("package.json", JSON.stringify(WEBPACK_SNAPSHOT_MANIFEST));
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
  });
});

describe("conditional omission and remount source slots", () => {
  const selectedParagraphMap =
    "props.paragraphs.map((paragraph, index) => <p key={index}>{index + 1}. {paragraph}</p>)";
  const otherParagraphMap =
    "props.otherParagraphs.map((paragraph, index) => <p key={index}>{index + 1}. {paragraph}</p>)";
  const routeCondition = 'props.location.pathname === "/first"';

  it.each([
    {
      title: "null omission",
      expression: `${routeCondition} ? <section>{${selectedParagraphMap}}</section> : null`,
      expectedCount: 0,
    },
    {
      title: "false omission",
      expression: `${routeCondition} ? <section>{${selectedParagraphMap}}</section> : false`,
      expectedCount: 0,
    },
    {
      title: "conjunction omission",
      expression: `<section>{${routeCondition} && ${selectedParagraphMap}}</section>`,
      expectedCount: 0,
    },
    {
      title: "distinct first native roots",
      expression: `${routeCondition} ? <article>{${selectedParagraphMap}}</article> : <section>{${otherParagraphMap}}</section>`,
      expectedCount: 0,
    },
    {
      title: "a genuine SDK fallback",
      expression: `${routeCondition} ? <section>{${selectedParagraphMap}}</section> : <Fallback/>`,
      expectedCount: 0,
    },
    {
      title: "different maps under one retained parent",
      expression: `<section>{${routeCondition} ? ${selectedParagraphMap} : ${otherParagraphMap}}</section>`,
      expectedCount: 2,
    },
    {
      title: "a single Fragment preserving the same first native root",
      expression: `${routeCondition} ? <><section>{${selectedParagraphMap}}</section></> : <section>{${otherParagraphMap}}</section>`,
      expectedCount: 2,
    },
  ])("checks $title", async ({ expression, expectedCount }) => {
    writeWebpackSnapshotFile(
      "src/reader.js",
      `import React from "react"; import {Route as Fallback} from "react-router-dom"; export default function Reader(props) { return ${expression}; }`,
    );
    expect(runWebpackSnapshotReader()).toHaveLength(expectedCount);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(expectedCount);
  });
});

describe("genuine Carousel remount alternatives", () => {
  const carouselReader = `import React from "react"; import {Carousel} from "antd";
    export default function Reader(props) { return props.location.pathname === "/first"
      ? <section>{props.paragraphs.map((paragraph,index) => <p key={index}>{index + 1}. {paragraph}</p>)}</section>
      : <><Carousel/></>; }`;

  it("allows a genuine AntD3 Carousel fallback after one Fragment normalization", async () => {
    writeWebpackSnapshotFile("src/reader.js", carouselReader);
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("rejects a local scalar shadow of the Carousel type", async () => {
    writeWebpackSnapshotFile(
      "src/reader.js",
      carouselReader
        .replace("import {Carousel}", "import {Carousel as GenuineCarousel}")
        .replace(
          "function Reader(props) {",
          "function Reader(props) { const Carousel = props.carousel;",
        ),
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects a source alias replacing the genuine Carousel package", async () => {
    writeWebpackSnapshotFile("src/reader.js", carouselReader);
    writeWebpackSnapshotFile("src/carousel.js", "export const Carousel = () => null;");
    replaceWebpackSnapshotSource({
      filename: "build/base.js",
      before: 'alias: { "@": path.resolve(__dirname, "../src") }',
      after:
        'alias: { "@": path.resolve(__dirname, "../src"), "antd": path.resolve(__dirname, "../src/carousel.js") }',
    });
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("rejects a relative counterfeit Carousel component", async () => {
    writeWebpackSnapshotFile("src/carousel.js", "export const Carousel = () => null;");
    writeWebpackSnapshotFile(
      "src/reader.js",
      carouselReader.replace('from "antd"', 'from "./carousel"'),
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it.each(["overrides", "resolutions"])(
    "rejects an AntD class replacement through %s",
    async (field) => {
      writeWebpackSnapshotFile("src/reader.js", carouselReader);
      writeWebpackSnapshotFile(
        "package.json",
        JSON.stringify({
          ...WEBPACK_SNAPSHOT_MANIFEST,
          [field]: { antd: "npm:counterfeit@3.26.0" },
        }),
      );
      expect(runWebpackSnapshotReader()).toHaveLength(1);
      expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
    },
  );

  it("keeps an unrelated compiler override outside the Carousel source role", async () => {
    writeWebpackSnapshotFile("src/reader.js", carouselReader);
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({
        ...WEBPACK_SNAPSHOT_MANIFEST,
        overrides: { "uglifyjs-webpack-plugin": "npm:custom-minifier@1.0.0" },
      }),
    );
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("rejects publication of the imported Carousel API anywhere in the source project", async () => {
    writeWebpackSnapshotFile("src/reader.js", carouselReader);
    writeWebpackSnapshotFile(
      "src/carousel-config.js",
      'import {Carousel} from "antd"; configure(Carousel);',
    );
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });
});

describe("mixed source and style extension candidates", () => {
  beforeEach(() => {
    replaceWebpackSnapshotSource({
      filename: "build/base.js",
      before: 'extensions: [".js", ".jsx", ".json"]',
      after: 'extensions: [".css", ".less", ".js", ".jsx", ".json"]',
    });
  });

  it("keeps a unique JavaScript source with unrelated presentation files", async () => {
    writeWebpackSnapshotFile("src/presentation.css", ".row { color: blue; }");
    writeWebpackSnapshotFile("src/presentation.less", ".row { color: blue; }");
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it.each([".css", ".less"])("holds a competing %s helper candidate", async (extension) => {
    writeWebpackSnapshotFile(`src/request${extension}`, ".row { color: blue; }");
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it.each([".css", ".less"])(
    "refreshes competing %s helper creation and removal under real cache hits",
    async (extension) => {
      expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
      expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
      expect(webpackCacheHitFileCount).toBeGreaterThan(0);
      writeWebpackSnapshotFile(`src/request${extension}`, ".row { color: blue; }");
      expect(runWebpackSnapshotReader()).toHaveLength(1);
      expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
      fs.rmSync(path.join(webpackFixtureDirectory, `src/request${extension}`));
      expect(runWebpackSnapshotReader()).toEqual([]);
      expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    },
  );
});

describe("known public HTTP capabilities", () => {
  const publishRequestEntry = () =>
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({ ...WEBPACK_SNAPSHOT_MANIFEST, main: "./src/request.js" }),
    );
  const exportClient = () => {
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after: 'import axios from "axios"; export const client = axios.create();',
    });
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: "axios({",
      after: "client({",
    });
  };

  it("keeps a public provider function that returns a fresh private snapshot", async () => {
    publishRequestEntry();
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it.each(["axios", "client"])("refuses public mutable %s capabilities", async (capability) => {
    publishRequestEntry();
    if (capability === "axios")
      replaceWebpackSnapshotSource({
        filename: "src/request.js",
        before: 'import axios from "axios";',
        after: 'import axios from "axios"; export { axios };',
      });
    else exportClient();
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });

  it("keeps an internal client behind a disjoint public entry", async () => {
    exportClient();
    writeWebpackSnapshotFile("src/public.js", "export const label = 'Published';");
    writeWebpackSnapshotFile(
      "package.json",
      JSON.stringify({ ...WEBPACK_SNAPSHOT_MANIFEST, main: "./src/public.js" }),
    );
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it("refreshes public client entry exposure under real cache hits", async () => {
    exportClient();
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
    expect(webpackCacheHitFileCount).toBeGreaterThan(0);
    publishRequestEntry();
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader(true)).toHaveLength(1);
    writeWebpackSnapshotFile("package.json", JSON.stringify(WEBPACK_SNAPSHOT_MANIFEST));
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader(true)).toEqual([]);
  });
});

describe("competing return namespaces", () => {
  it("keeps both warnings when an early return and final return share the same native root", async () => {
    writeWebpackSnapshotFile(
      "src/reader.js",
      `import React from "react"; export default function Reader(props) { if (props.location.pathname === "/alternate") return <section>{props.otherParagraphs.map((paragraph,index) => <p key={index}>{index+1}. {paragraph}</p>)}</section>; return <section>{props.paragraphs.map((paragraph,index) => <p key={index}>{index+1}. {paragraph}</p>)}</section>; }`,
    );
    expect(runWebpackSnapshotReader()).toHaveLength(2);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(2);
  });
});

describe("source capability aliases and passive computed data", () => {
  it.each([
    {
      title: "a const identifier resolving the inherited constructor",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after:
        'import axios from "axios"; class Carrier {} const memberName = "constructor"; Carrier[memberName]("return JSON")().parse = foreignDecoder;',
    },
    {
      title: "a concatenation resolving the inherited constructor",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after:
        'import axios from "axios"; class Carrier {} Carrier["con" + "structor"]("return JSON")().parse = foreignDecoder;',
    },
    {
      title: "an opaque computed member invoked as a constructor capability",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after:
        'import axios from "axios"; class Carrier {} const chooseName = () => "constructor"; Carrier[chooseName()]("return JSON")().parse = foreignDecoder;',
    },
    {
      title: "an opaque computed constructor capability escaping through aliases",
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after:
        'import axios from "axios"; class Carrier {} const chooseName = () => "constructor"; const buildFunction = Carrier[chooseName()]; const decoder = buildFunction("return JSON")(); decoder.parse = foreignDecoder;',
    },
    ...[
      {
        title: "an unsafe initial tag followed by a conditional safe assignment",
        declaration:
          'const SafeComponent = () => <div/>; let Frame = "iframe"; if (condition) Frame = SafeComponent;',
      },
      {
        title: "an opaque local tag-producing call",
        declaration: 'const getFrame = () => "iframe"; const Frame = getFrame();',
      },
      {
        title: "a compound tag-producing assignment",
        declaration: 'let Frame = "ifr"; Frame += "ame";',
      },
    ].map(({ title, declaration }) => ({
      title,
      filename: "src/index.js",
      before:
        'ReactDOM.render(<LocaleProvider locale={enUS}><Boundary><Shell /></Boundary></LocaleProvider>, document.getElementById("root"));',
      after: `${declaration} ReactDOM.render(<><Frame src="/decoder.html"/><LocaleProvider locale={enUS}><Boundary><Shell /></Boundary></LocaleProvider></>, document.getElementById("root"));`,
    })),
    ...["let", "var"].map((declarationKind) => ({
      title: `an unreassigned ${declarationKind} executable native tag alias`,
      filename: "src/index.js",
      before:
        'ReactDOM.render(<LocaleProvider locale={enUS}><Boundary><Shell /></Boundary></LocaleProvider>, document.getElementById("root"));',
      after: `${declarationKind} Frame = "iframe"; ReactDOM.render(<><Frame src="/decoder.html"/><LocaleProvider locale={enUS}><Boundary><Shell /></Boundary></LocaleProvider></>, document.getElementById("root"));`,
    })),
  ])("rejects $title", async (mutation) => {
    replaceWebpackSnapshotSource({
      filename: "src/request.js",
      before: 'import axios from "axios";',
      after:
        'const captionName = "heading"; const captions = {heading: "Caption"}; void captions[captionName]; void captions[runtimeCaptionName]; import axios from "axios";',
    });
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
    replaceWebpackSnapshotSource(mutation);
    expect(runWebpackSnapshotReader()).toHaveLength(1);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(1);
  });
});

describe("native source presentation with a fixed ordinal slot", () => {
  const styledReader = `import React from "react"; export default function Reader(props) { return <section style={props.theme}>{props.paragraphs.map((paragraph, index) => <span style={{marginLeft: index * 2}} key={index}>{index + 1}. {paragraph}</span>)}</section>; }`;

  it("allows read-only index presentation and disjoint ancestor style data", async () => {
    writeWebpackSnapshotFile("src/reader.js", styledReader);
    expect(runWebpackSnapshotReader()).toEqual([]);
    expect(await runNativeWebpackSnapshotReader()).toEqual([]);
  });

  it.each([
    {
      title: "target receiver read in style",
      before: "marginLeft: index * 2",
      after: "marginLeft: props.paragraphs.length",
      expected: 1,
    },
    {
      title: "target receiver write in style",
      before: "marginLeft: index * 2",
      after: "marginLeft: props.paragraphs.reverse().length",
      expected: 1,
    },
    {
      title: "target receiver captured by a nested style closure",
      before: "marginLeft: index * 2",
      after: "lookup: () => props.paragraphs",
      expected: 1,
    },
    {
      title: "native HTML injection",
      before: "<span style=",
      after: '<span dangerouslySetInnerHTML={{__html: "injected"}} style=',
      expected: 1,
    },
    {
      title: "JSX attribute spread",
      before: "<span style=",
      after: "<span {...props.theme} style=",
      expected: 1,
    },
    {
      title: "duplicate key attributes",
      before: "key={index}",
      after: "key={index} key={index}",
      expected: 2,
    },
    {
      title: "a modulo key namespace",
      before: "key={index}",
      after: "key={index % 2}",
      expected: 1,
    },
    {
      title: "an index write before the key",
      before: "marginLeft: index * 2",
      after: "marginLeft: (index = 0)",
      expected: 1,
    },
  ])("holds the native ordinal proof for $title", async ({ before, after, expected }) => {
    writeWebpackSnapshotFile("src/reader.js", styledReader);
    replaceWebpackSnapshotSource({ filename: "src/reader.js", before, after });
    expect(runWebpackSnapshotReader()).toHaveLength(expected);
    expect(await runNativeWebpackSnapshotReader()).toHaveLength(expected);
  });
});
