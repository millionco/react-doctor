import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getClosedJsonSnapshotSourceRole } from "./get-closed-json-snapshot-source-role.js";

const directories: string[] = [];
const createProject = (overrides: Record<string, unknown> = {}): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-source-role-"));
  directories.push(directory);
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      dependencies: {
        react: "^16.8.0",
        "react-dom": "^16.2.0",
        axios: "^0.21.0",
        "react-router-dom": "^5.1.0",
      },
      ...overrides,
    }),
  );
  return directory;
};
const writeDependency = (directory: string, name: string, declaration: string): void => {
  const filename = path.join(directory, "package.json");
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  manifest.dependencies[name] = declaration;
  fs.writeFileSync(filename, JSON.stringify(manifest));
};
const writeFile = (directory: string, filename: string, source: string): void => {
  const absolutePath = path.join(directory, filename);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, source);
};
const yarnEntry = (name: string, declaration: string, version: string): string =>
  `# yarn lockfile v1\n\n${JSON.stringify(`${name}@${declaration}`)}:\n  version "${version}"\n  resolved "https://registry.yarnpkg.com/${name}/-/${name}-${version}.tgz#${"a".repeat(40)}"\n`;
const readRole = (directory: string) =>
  getClosedJsonSnapshotSourceRole(path.join(directory, "src/view.js"));

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("fixed snapshot source API and resolution roles", () => {
  it("requires source APIs without app, build, or installed-output attestation", () => {
    const directory = createProject();
    expect(readRole(directory)).toEqual({
      projectDirectory: directory,
      allowsJavaScriptJsx: true,
      hasLodashEmptiness: false,
      hasAntdLocaleProvider: false,
      axiosVersion: "0.17.0 || 0.17.1 || 0.18.0 || 0.18.1 || >=0.19.0 <0.22.0",
      decoderRole: "browser-native-json",
      knownPublicEntryTargets: ["./index"],
      sourceResolutionPolicy: {
        rootDirectory: directory,
        extensions: [".js", ".jsx", ".mjs", ".json"],
        aliases: [],
      },
    });
  });
  it.each([
    "^16.0.0",
    ">=16.8.0",
    "16.8.0 || 18.0.0",
    "16.8.0-beta.1",
    "npm:react@16.8.0",
    "file:react",
    "workspace:^16.8.0",
    "latest",
    "16.08.0",
    ">=16.8.0 <=17.0.0",
  ])("retains incompatible or unresolved React declaration refusal: %s", (declaration) => {
    const directory = createProject();
    writeDependency(directory, "react", declaration);
    expect(readRole(directory)).toBeNull();
  });
  it.each(["16.8.0", "~16.8.0", ">=16.8.0 <17.0.0", "^16.8", "16.8.x", "16.9.0 || 16.14.0"])(
    "admits fully contained stable React source API range: %s",
    (declaration) => {
      const directory = createProject();
      writeDependency(directory, "react", declaration);
      expect(readRole(directory)).not.toBeNull();
    },
  );
  it.each(["16.2.0", "16.7.0", "^16.0.0", "^16.2.0"])(
    "uses the ordinary committed-Hook conditional role with DOM16: %s",
    (declaration) => {
      const directory = createProject();
      writeDependency(directory, "react-dom", declaration);
      expect(readRole(directory)).not.toBeNull();
    },
  );
  it.each(["0.17.0", "0.17.1", "0.18.0", "0.18.1", "^0.19.0", "^0.21.0"])(
    "keeps the reviewed native JSON decoder source cohort: %s",
    (declaration) => {
      const directory = createProject();
      writeDependency(directory, "axios", declaration);
      expect(readRole(directory)).not.toBeNull();
    },
  );
  it.each(["0.17.2", "0.18.2", "^0.17.0", "0.22.0", "npm:custom-axios@0.21.0"])(
    "does not widen native decoder source cohorts: %s",
    (declaration) => {
      const directory = createProject();
      writeDependency(directory, "axios", declaration);
      expect(readRole(directory)).toBeNull();
    },
  );
  it("allows optional genuine selector evidence without making locks mandatory", () => {
    const directory = createProject();
    writeDependency(directory, "react", "^16.0.0");
    expect(readRole(directory)).toBeNull();
    writeFile(directory, "yarn.lock", yarnEntry("react", "^16.0.0", "16.14.0"));
    expect(readRole(directory)).not.toBeNull();
    writeFile(directory, "yarn.lock", yarnEntry("react", "^16.0.0", "17.0.0"));
    expect(readRole(directory)).toBeNull();
  });
  it.each(["^4.0.0", "4.3.0", "4.3.2", "6.0.0"])(
    "keeps Route API cohorts bounded: %s",
    (declaration) => {
      const directory = createProject();
      writeDependency(directory, "react-router-dom", declaration);
      expect(readRole(directory)).toBeNull();
    },
  );
  it("migrates exact Route4 transitive-lock attestation refusal to an ordinary source API role", () => {
    const directory = createProject();
    writeDependency(directory, "react-router-dom", "4.3.1");
    expect(readRole(directory)).not.toBeNull();
    writeFile(directory, "yarn.lock", yarnEntry("react-router", "^4.3.1", "5.1.2"));
    expect(readRole(directory)).not.toBeNull();
  });
  it.each([
    { private: false },
    { main: "src/view.js", module: "src/view.js", exports: "./src/view.js" },
    { scripts: { build: "node tools/build.js" } },
    { packageManager: "pnpm@10.0.0" },
    { devDependencies: { webpack: "99.0.0", "react-hot-loader": "99.0.0" } },
    { resolutions: { "unrelated-compiler-package": "99.0.0" } },
    { browser: { "./server.js": "./browser.js" } },
  ])("explicitly migrates attestation-only metadata negatives out of source scope", (overrides) => {
    const directory = createProject(overrides);
    expect(readRole(directory)).not.toBeNull();
  });
  it("does not turn unrelated local dependency protocols or CSS config into API origin claims", () => {
    const directory = createProject();
    writeDependency(directory, "unrelated", "file:./tools");
    writeFile(directory, ".babelrc", JSON.stringify({ plugins: ["unknown-build-plugin"] }));
    writeFile(directory, ".env.production", "NODE_PATH=./compiler-only\n");
    expect(readRole(directory)).not.toBeNull();
  });
  it.each([
    { browser: { react: "preact/compat" } },
    { browser: { axios: "./client.js" } },
    { resolutions: { react: "18.0.0" } },
    { overrides: { axios: "0.22.0" } },
  ])("retains known direct source API origin contradictions", (overrides) => {
    expect(readRole(createProject(overrides))).toBeNull();
  });
  it("keeps optional source SDK roles conditional", () => {
    const directory = createProject();
    writeDependency(directory, "lodash", "^4.17.0");
    writeDependency(directory, "antd", "^3.0.0");
    expect(readRole(directory)).toMatchObject({
      hasLodashEmptiness: true,
      hasAntdLocaleProvider: true,
    });
    writeDependency(directory, "lodash", "npm:replacement@4.17.0");
    writeDependency(directory, "antd", "4.0.0");
    expect(readRole(directory)).toMatchObject({
      hasLodashEmptiness: false,
      hasAntdLocaleProvider: false,
    });
  });
  it("projects literal resolver facts while opaque compiler values remain outside the projection", () => {
    const directory = createProject();
    writeFile(
      directory,
      "webpack.config.js",
      `const path=require('path'); const Unknown=require('unknown-plugin'); module.exports={ context:path.resolve(__dirname,'.'), resolve:{extensions:['.jsx','.js'],alias:{client:path.resolve(__dirname,'src/client')}}, plugins:[new Unknown(opaque())], module:{rules:unknownStyleChain()}, output:externalOutput() };`,
    );
    expect(readRole(directory)?.sourceResolutionPolicy).toEqual({
      rootDirectory: directory,
      extensions: [".jsx", ".js"],
      aliases: [
        { name: "client", exact: false, targetAbsolutePath: path.join(directory, "src/client") },
      ],
      configFilePaths: [path.join(directory, "webpack.config.js")],
    });
  });
  it("uses a literal config selector without attesting the surrounding build command", () => {
    const directory = createProject({
      scripts: { build: "webpack --custom --config ./build/production.js && opaque-command" },
    });
    writeFile(
      directory,
      "build/production.js",
      `const merge=require('webpack-merge'); const base=require('./base'); module.exports=merge(base,{plugins:[new Unknown()]});`,
    );
    writeFile(
      directory,
      "build/base.js",
      `const path=require('path'); module.exports={resolve:{alias:{'@':path.resolve(__dirname,'../src')}}};`,
    );
    expect(readRole(directory)?.sourceResolutionPolicy.aliases[0]?.name).toBe("@");
    expect(readRole(directory)?.sourceResolutionPolicy.configFilePaths).toHaveLength(2);
  });
  it.each([
    "webpack --config --progress.js",
    "webpack --config --progress",
    "webpack --config $CONFIG",
    "webpack --config ./one.js --config ./two.js",
  ])("holds unknown or ambiguous required config selection: %s", (build) => {
    expect(readRole(createProject({ scripts: { build } }))).toBeNull();
  });
  it.each([
    { presets: [["react", { pragma: "h" }]] },
    { plugins: [["transform-react-jsx", { pragma: "h" }]] },
    { presets: [["@babel/preset-react", { runtime: "automatic" }]] },
  ])("holds visible custom JSX conventions", (config) => {
    const directory = createProject();
    writeFile(directory, ".babelrc", JSON.stringify(config));
    expect(readRole(directory)).toBeNull();
  });
  it.each([
    { compilerOptions: { jsxFactory: "h" } },
    { compilerOptions: { baseUrl: "src" } },
    { compilerOptions: { paths: { client: ["./client"] } } },
    { extends: "./unknown.json" },
  ])("holds conflicting JSX or unknown required source resolution metadata", (config) => {
    const directory = createProject();
    writeFile(directory, "tsconfig.json", JSON.stringify(config));
    expect(readRole(directory)).toBeNull();
  });
  it.each([".babelrc", "jsconfig.json", "tsconfig.json"])(
    "holds present but unparsed JSX/resolver metadata: %s",
    (filename) => {
      const directory = createProject();
      writeFile(
        directory,
        filename,
        '{ // unparsed convention\n "compilerOptions": {"jsxFactory":"h"} }',
      );
      expect(readRole(directory)).toBeNull();
    },
  );
  it.each([null, [], "opaque"])("holds nonrecord manifest Babel convention metadata", (babel) => {
    expect(readRole(createProject({ babel }))).toBeNull();
  });
  it("distinguishes absent DOM metadata from a contradictory declared binding", () => {
    const directory = createProject({ devDependencies: { "react-dom": "16.14.0" } });
    expect(readRole(directory)).toBeNull();
  });
  it.each([
    ".babelrc.js",
    ".babelrc.cjs",
    ".babelrc.mjs",
    "babel.config.js",
    "babel.config.cjs",
    "babel.config.mjs",
  ])("holds present executable JSX configuration without evaluating it: %s", (filename) => {
    const directory = createProject();
    writeFile(
      directory,
      filename,
      `module.exports={plugins:[['transform-react-jsx',{pragma:'h'}]]};`,
    );
    expect(readRole(directory)).toBeNull();
    fs.unlinkSync(path.join(directory, filename));
    expect(readRole(directory)).not.toBeNull();
  });
  it.each([".babelrc.json", "babel.config.json"])(
    "uses the same strict JSON convention projection for %s",
    (filename) => {
      const directory = createProject();
      writeFile(directory, filename, JSON.stringify({ presets: [["react", { pragma: "h" }]] }));
      expect(readRole(directory)).toBeNull();
      writeFile(
        directory,
        filename,
        JSON.stringify({ presets: [["react", { pragma: "React.createElement" }]] }),
      );
      expect(readRole(directory)).not.toBeNull();
      writeFile(directory, filename, JSON.stringify({ extends: "./unknown-conventions.json" }));
      expect(readRole(directory)).toBeNull();
    },
  );
  it("reports known literal package entry targets without rejecting package metadata", () => {
    const directory = createProject({
      main: "./src/main.js",
      module: "./src/module.js",
      "jsnext:main": "./src/next.js",
      exports: {
        ".": {
          import: ["./src/import.js", { browser: "./src/browser.js" }],
          require: "./src/require.js",
        },
      },
      browser: { "./src/other.js": "./src/browser-replacement.js" },
    });
    expect(new Set(readRole(directory)?.knownPublicEntryTargets)).toEqual(
      new Set([
        "./src/main.js",
        "./src/module.js",
        "./src/next.js",
        "./src/import.js",
        "./src/browser.js",
        "./src/require.js",
        "./src/browser-replacement.js",
      ]),
    );
  });
  it("refreshes public entry facts through the existing fresh manifest read", () => {
    const directory = createProject({ exports: { ".": "./src/first.js" } });
    expect(readRole(directory)?.knownPublicEntryTargets).toEqual(["./src/first.js"]);
    const filename = path.join(directory, "package.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    manifest.exports = { ".": { default: "./src/second.js" } };
    fs.writeFileSync(filename, JSON.stringify(manifest));
    expect(readRole(directory)?.knownPublicEntryTargets).toEqual(["./src/second.js"]);
  });
  it.each(["browser", "resolutions", "overrides"])(
    "holds contradictory direct optional SDK and DOM replacement roles in %s",
    (field) => {
      for (const [name, replacement] of [
        ["react-dom", "18.0.0"],
        ["antd", "npm:counterfeit@3.26.0"],
        ["antd", "4.0.0"],
        ["lodash", "npm:counterfeit@4.17.0"],
        ["lodash", "3.0.0"],
      ]) {
        const directory = createProject({ [field]: { [name]: replacement } });
        writeDependency(directory, "antd", "3.26.0");
        writeDependency(directory, "lodash", "4.17.0");
        expect(readRole(directory)).toBeNull();
      }
    },
  );
  it.each(["resolutions", "overrides"])(
    "retains genuine supported replacement role evidence in %s",
    (field) => {
      const directory = createProject({
        [field]: { "react-dom": "16.2.0", antd: "3.26.0", lodash: "4.17.0" },
      });
      writeDependency(directory, "antd", "3.26.0");
      writeDependency(directory, "lodash", "4.17.0");
      expect(readRole(directory)).toMatchObject({
        hasAntdLocaleProvider: true,
        hasLodashEmptiness: true,
      });
    },
  );
  it.each([
    { resolutions: { "**/antd": "npm:counterfeit@3.26.0" } },
    { resolutions: { "antd@^3.0.0": "npm:counterfeit@3.26.0" } },
    { overrides: { tooling: { antd: "npm:counterfeit@3.26.0" } } },
    { overrides: { antd: { ".": "npm:counterfeit@3.26.0" } } },
    { overrides: { tooling: { "object-assign": "npm:counterfeit@4.1.0" } } },
    { browser: { "history/internal": "./src/replacement.js" } },
  ])("holds opaque relevant SDK selector or nested replacement metadata", (overrides) => {
    const directory = createProject(overrides);
    writeDependency(directory, "antd", "3.26.0");
    expect(readRole(directory)).toBeNull();
  });
  it("keeps unrelated exact compiler replacement names outside SDK source bindings", () => {
    const directory = createProject({
      overrides: { "react-compiler-tools": "99.0.0", utils: "file:./utils" },
      resolutions: { tooling: { "styles-compiler": "99.0.0" } },
    });
    expect(readRole(directory)).not.toBeNull();
  });
  it("does not confuse similarly spelled package names with native SDK selector heads", () => {
    const directory = createProject({
      resolutions: { "**/react-compiler-tools": "99.0.0", "**/preact": "10.0.0" },
    });
    expect(readRole(directory)).not.toBeNull();
  });
  it("includes the standard package root index when main and exports are absent", () => {
    const directory = createProject();
    expect(readRole(directory)?.knownPublicEntryTargets).toEqual(["./index"]);
    const filename = path.join(directory, "package.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    manifest.main = "./src/explicit.js";
    fs.writeFileSync(filename, JSON.stringify(manifest));
    expect(readRole(directory)?.knownPublicEntryTargets).toEqual(["./index", "./src/explicit.js"]);
  });
  it("keeps root index as a potential fallback alongside a missing main target", () => {
    expect(readRole(createProject({ main: "./missing.js" }))?.knownPublicEntryTargets).toEqual([
      "./index",
      "./missing.js",
    ]);
  });
  it.each([{ exports: null }, { exports: false }])(
    "holds invalid top-level package entry shapes",
    (metadata) => {
      expect(readRole(createProject(metadata))).toBeNull();
    },
  );
  it.each([null, {}, { nested: "./src/ignored.js" }, false, 0])(
    "uses the default index instead of invalid main payloads",
    (main) => {
      expect(readRole(createProject({ main }))?.knownPublicEntryTargets).toEqual(["./index"]);
      expect(
        readRole(createProject({ main, exports: "./src/public.js" }))?.knownPublicEntryTargets,
      ).toEqual(["./src/public.js"]);
    },
  );
  it("includes the root index fallback for an empty main string", () => {
    expect(readRole(createProject({ main: "" }))?.knownPublicEntryTargets).toEqual(["./index"]);
    expect(
      readRole(createProject({ main: "", exports: "./src/public.js" }))?.knownPublicEntryTargets,
    ).toEqual(["./src/public.js"]);
  });
  it("refreshes source metadata and resolution facts between calls", () => {
    const directory = createProject();
    writeFile(
      directory,
      "webpack.config.js",
      `const path=require('path'); module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/one')}}};`,
    );
    expect(readRole(directory)?.sourceResolutionPolicy.aliases[0]?.targetAbsolutePath).toBe(
      path.join(directory, "src/one"),
    );
    writeFile(
      directory,
      "webpack.config.js",
      `const path=require('path'); module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/two')}}};`,
    );
    expect(readRole(directory)?.sourceResolutionPolicy.aliases[0]?.targetAbsolutePath).toBe(
      path.join(directory, "src/two"),
    );
    writeDependency(directory, "react", "18.0.0");
    expect(readRole(directory)).toBeNull();
  });
});
