import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import { captureCrossFileProbes } from "./cross-file-probe-recorder.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resetFilesystemCaches } from "./reset-filesystem-caches.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";

interface AliasFixture {
  readonly config?: string;
  readonly build?: string;
  readonly start?: string;
  readonly base?: string;
  readonly packageFields?: Record<string, unknown>;
  readonly files?: Record<string, string>;
}

let temporaryDirectory: string;
const baseConfig = `const path = require('path');
const config = { resolve: { extensions: ['.js', '.jsx'], alias: { utility: path.resolve(__dirname, '../src/utility') } } };
module.exports = config;`;
const buildConfig = `const merge = require('webpack-merge');
const base = require('../build/webpack.base');
const extra = { output: { filename: 'bundle.js' } };
const result = merge(base, extra);
module.exports = result;`;

const writeFile = (relativePath: string, contents: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};

const fixture = (options: AliasFixture = {}): string => {
  writeFile(
    "package.json",
    JSON.stringify({
      name: "alias-fixture",
      scripts: {
        build: options.build ?? "webpack --config ./scripts/build.js --progress",
        ...(options.start ? { start: options.start } : {}),
      },
      devDependencies: {
        webpack: "^3.10.0",
        "webpack-merge": "^4.1.1",
        "plugin-package": "^1.0.0",
        "config-tool": "^1.0.0",
        "cross-env": "^5.2.0",
        "webpack-dev-server": "^2.10.0",
      },
      ...options.packageFields,
    }),
  );
  writeFile("scripts/build.js", options.config ?? buildConfig);
  writeFile("build/webpack.base.js", options.base ?? baseConfig);
  writeFile("src/utility/format.js", "export const format = value => value;");
  for (const [filename, contents] of Object.entries(options.files ?? {}))
    writeFile(filename, contents);
  return writeFile(
    "src/panel.jsx",
    "import { format } from 'utility/format'; export const Panel = () => <div>{format('text')}</div>;",
  );
};

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "webpack-script-alias-"));
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("resolveWebpackAliasPath", () => {
  it("follows the selected exported merge through a dotted extensionless config require", () => {
    const consumer = fixture();
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toEqual({
      declared: true,
      filePath: path.join(temporaryDirectory, "src/utility/format.js"),
    });
    expect(resolveModulePath(consumer, "utility/format")).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
  });

  it("requires agreeing build and start exports, including cross-env script selection", () => {
    const consumer = fixture({
      start:
        "cross-env NODE_ENV=development webpack-dev-server --config ./scripts/start.js --progress",
      files: { "scripts/start.js": buildConfig },
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")?.filePath).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
  });

  it("uses the build-only profile only when explicitly requested", () => {
    const consumer = fixture({
      start: "webpack-dev-server --config ./scripts/start.js",
      files: {
        "scripts/start.js": `const merge=require('webpack-merge');const base=require('../build/webpack.base');const data=require('./data');module.exports=merge(base,{devServer:{proxy:data}});`,
        "scripts/data.js": `module.exports = { '/api': 'http://localhost' };`,
      },
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toBeNull();
    expect(resolveModulePath(consumer, "utility/format")).toBeNull();
    expect(
      resolveWebpackAliasPath(consumer, "utility/format", { profile: "build-script" }),
    ).toEqual({ declared: true, filePath: path.join(temporaryDirectory, "src/utility/format.js") });
    expect(
      resolveCrossFileValueExportWithFilePath(consumer, "utility/format", "format"),
    ).toBeNull();
  });

  it("allows unrelated declarative configuration values without extracting dormant aliases", () => {
    const consumer = fixture({
      config: `const merge=require('webpack-merge'); const base=require('../build/webpack.base');
const dormant={resolve:{alias:{utility:'/unselected'}}}; const plugins=require('plugin-package');
const options={plugins:[new plugins.Tool()],devServer:{port:8080}}; module.exports=merge(base,options);`,
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")?.filePath).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
  });

  it("keeps declared extension order when a TypeScript sibling exists", () => {
    const consumer = fixture({
      files: { "src/utility/format.ts": "export const format = () => false;" },
    });
    expect(resolveModulePath(consumer, "utility/format")).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
  });

  it("tries JSX before JavaScript when explicitly configured that way", () => {
    const consumer = fixture({
      base: baseConfig.replace("['.js', '.jsx']", "['.jsx', '.js']"),
      files: { "src/utility/format.jsx": "export const format = () => null;" },
    });
    expect(resolveModulePath(consumer, "utility/format")).toBe(
      path.join(temporaryDirectory, "src/utility/format.jsx"),
    );
  });

  it("supports exact-dollar aliases and refuses suffix matching for them", () => {
    const consumer = fixture({
      base: baseConfig
        .replace("utility:", () => "'utility$':")
        .replace("'../src/utility'", "'../src/utility/format.js'"),
    });
    expect(resolveWebpackAliasPath(consumer, "utility")?.filePath).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toEqual({
      declared: false,
      filePath: null,
    });
  });

  it("does not fall back to tsconfig when a recognized alias target is missing", () => {
    const consumer = fixture({
      base: baseConfig.replace("../src/utility", "../missing"),
      files: {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "utility/*": ["src/utility/*"] } },
        }),
      },
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toEqual({
      declared: true,
      filePath: null,
    });
    expect(resolveModulePath(consumer, "utility/format")).toBeNull();
  });

  it("does not substitute TypeScript when only that extension exists", () => {
    const consumer = fixture({ files: { "src/utility/typed.ts": "export const typed = true;" } });
    expect(resolveWebpackAliasPath(consumer, "utility/typed")).toEqual({
      declared: true,
      filePath: null,
    });
  });

  it("preserves existing tsconfig behavior when no supported Webpack profile applies", () => {
    const consumer = fixture({
      build: "vite build",
      files: {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "utility/*": ["src/utility/*"] } },
        }),
      },
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toBeNull();
    expect(resolveModulePath(consumer, "utility/format")).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
  });

  it("allows readonly metadata comparison on a selected companion config", () => {
    const consumer = fixture({
      config: `const merge=require('webpack-merge'); const base=require('../build/webpack.base');
const options={plugins:[]}; const extra={devServer:{historyApiFallback:options.plugins.length < 2}};
module.exports=merge(base,options,extra);`,
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")?.declared).toBe(true);
  });

  const unsupported: readonly [string, AliasFixture][] = [
    [
      "alias name exceeds the finite segment budget",
      {
        base: baseConfig.replace(
          "utility:",
          "'one/two/three/four/five/six/seven/eight/nine/ten/eleven/twelve/thirteen/fourteen/fifteen/sixteen/seventeen':'/other', utility:",
        ),
      },
    ],
    [
      "duplicate configured extensions",
      { base: baseConfig.replace("['.js', '.jsx']", "['.js', '.js']") },
    ],
    [
      "alias prefix overlap with an interleaved sibling",
      {
        base: baseConfig.replace(
          "utility:",
          "'utility-other':'/other', 'utility/nested':'/nested', utility:",
        ),
      },
    ],
    [
      "normalized exact and prefix alias collision",
      { base: baseConfig.replace("utility:", () => "'utility$':'/other', utility:") },
    ],
    ["malformed numeric scripts record", { packageFields: { scripts: 42 } }],
    ["malformed dependency record", { packageFields: { dependencies: "invalid" } }],
    [
      "malformed null optional dependency record",
      { packageFields: { optionalDependencies: null } },
    ],
    ["malformed numeric peer dependency record", { packageFields: { peerDependencies: 0 } }],
    ["malformed array scripts record", { packageFields: { scripts: [] } }],
    ["shell composition", { build: "prepare && webpack --config ./scripts/build.js" }],
    [
      "unknown CLI override",
      { build: "webpack --config ./scripts/build.js --resolve-alias utility=other" },
    ],
    [
      "duplicate CLI configs",
      { build: "webpack --config ./scripts/build.js --config ./scripts/start.js" },
    ],
    [
      "Node module path environment remap",
      { build: "cross-env NODE_PATH=./custom webpack --config ./scripts/build.js" },
    ],
    [
      "Node options environment remap",
      { build: "cross-env NODE_OPTIONS=--require=./patch webpack --config ./scripts/build.js" },
    ],
    [
      "multiple environment assignments",
      {
        build:
          "cross-env NODE_ENV=production NODE_PATH=./custom webpack --config ./scripts/build.js",
      },
    ],
    [
      "aliased cross-env command provider",
      {
        build: "cross-env NODE_ENV=production webpack --config ./scripts/build.js",
        packageFields: {
          devDependencies: {
            webpack: "^3.10.0",
            "webpack-merge": "^4.1.1",
            "cross-env": "npm:replacement@5.2.0",
          },
        },
      },
    ],
    [
      "aliased dev-server command provider",
      {
        build: "webpack-dev-server --config ./scripts/build.js",
        packageFields: {
          devDependencies: {
            webpack: "^3.10.0",
            "webpack-merge": "^4.1.1",
            "webpack-dev-server": "npm:replacement@2.10.0",
          },
        },
      },
    ],
    [
      "lifecycle script",
      {
        packageFields: {
          scripts: { build: "webpack --config ./scripts/build.js", prebuild: "node mutate.js" },
        },
      },
    ],
    [
      "unsupported Webpack version",
      { packageFields: { devDependencies: { webpack: "^5.0.0", "webpack-merge": "^4.1.1" } } },
    ],
    [
      "aliased package protocol",
      {
        packageFields: {
          devDependencies: { webpack: "npm:other@3.10.0", "webpack-merge": "^4.1.1" },
        },
      },
    ],
    ["package override metadata", { packageFields: { overrides: { webpack: "other" } } }],
    ["ES module package configuration", { packageFields: { type: "module" } }],
    [
      "own browser remapping metadata",
      { packageFields: { browser: { "./src/utility/format.js": "./different.js" } } },
    ],
    [
      "factory export",
      {
        config: `module.exports = () => ({resolve:{alias:{utility:'/wrong'},extensions:['.js']}});`,
      },
    ],
    [
      "conditional export",
      { config: `if(process.env.NODE_ENV === 'production') module.exports = {};` },
    ],
    ["early throw", { config: `throw null; ${buildConfig}` }],
    [
      "export before const initialization",
      {
        config: `module.exports=config;const config={resolve:{alias:{utility:'/wrong'},extensions:['.js']}};`,
      },
    ],
    [
      "config object mutation",
      { config: `${buildConfig}\nbase.resolve.alias.utility = '/wrong';` },
    ],
    [
      "selected object alias escape",
      {
        config: `const merge=require('webpack-merge');const base=require('../build/webpack.base');const escaped=base;module.exports=merge(base,{});`,
      },
    ],
    [
      "selected object opaque argument",
      {
        config: `const merge=require('webpack-merge');const base=require('../build/webpack.base');const alter=require('config-tool');const changed=alter(base);module.exports=merge(base,{});`,
      },
    ],
    [
      "own relative side-effect import",
      {
        config: `const merge=require('webpack-merge');const base=require('../build/webpack.base');const patch=require('./patch');module.exports=merge(base,{});`,
        files: {
          "scripts/patch.js": `const base=require('../build/webpack.base');base.resolve.alias.utility='/changed';module.exports=()=>{};`,
        },
      },
    ],
    [
      "own relative callable patch",
      {
        config: `const merge=require('webpack-merge');const base=require('../build/webpack.base');const patch=require('./patch');const applied=patch();module.exports=merge(base,{});`,
        files: {
          "scripts/patch.js": `const base=require('../build/webpack.base');module.exports=()=>{base.resolve.alias.utility='/changed';};`,
        },
      },
    ],
    [
      "Node JSON config before directory index",
      {
        config: `const base=require('../build/profile');module.exports=base;`,
        files: {
          "build/profile.json": JSON.stringify({
            resolve: { extensions: [".js"], alias: { utility: "/changed" } },
          }),
          "build/profile/index.js": baseConfig,
        },
      },
    ],
    [
      "unsupported directory config",
      {
        config: `const base=require('../build/profile');module.exports=base;`,
        files: { "build/profile/index.js": baseConfig },
      },
    ],
    [
      "merge namespace mutation",
      {
        config: `const merge=require('webpack-merge');const base=require('../build/webpack.base');merge.customize=()=>({});module.exports=merge(base,{});`,
      },
    ],
    [
      "merge alias extraction",
      {
        config: `const merge=require('webpack-merge');const alias=merge;const base=require('../build/webpack.base');module.exports=merge(base,{});`,
      },
    ],
    [
      "single-argument merge customizer overload",
      {
        config: `const merge=require('webpack-merge');const path=require('path');const options={customizeArray:()=>[],resolve:{extensions:['.js'],alias:{utility:path.resolve(__dirname,'../src/utility')}}};module.exports=merge(options);`,
      },
    ],
    [
      "single-argument plain merge outside the finite grammar",
      {
        config: `const merge=require('webpack-merge');const base=require('../build/webpack.base');module.exports=merge(base);`,
      },
    ],
    ["path method replacement", { base: `${baseConfig}\npath.resolve=()=>'/wrong';` }],
    [
      "path alias extraction",
      { base: baseConfig.replace("const config", "const escaped=path; const config") },
    ],
    [
      "path provider shadow",
      { base: baseConfig.replace("require('path')", "require('custom-path')") },
    ],
    [
      "known dynamic capability",
      { base: `const config=({}).constructor.constructor('return {}')();module.exports=config;` },
    ],
    [
      "unknown global capability",
      { base: `const changed=window.Function('return {}')(); ${baseConfig}` },
    ],
    [
      "native dynamic code loader",
      {
        base: `const changed=require('vm').runInThisContext('module.exports = {}'); ${baseConfig}`,
      },
    ],
    ["computed alias property", { base: baseConfig.replace("utility:", "['utility']:") }],
    [
      "getter alias property",
      {
        base: baseConfig.replace(
          "utility: path.resolve(__dirname, '../src/utility')",
          "get utility(){return '/wrong'}",
        ),
      },
    ],
    [
      "default export unwrapping",
      {
        base: baseConfig.replace(
          "const config = {",
          "const config = { default: {resolve:{extensions:['.js'],alias:{utility:'/different'}}},",
        ),
      },
    ],
    [
      "thenable config export",
      {
        base: baseConfig.replace(
          "const config = {",
          "const config = { then: accept => accept({resolve:{extensions:['.js'],alias:{utility:'/different'}}}),",
        ),
      },
    ],
    [
      "merged default export unwrapping",
      {
        config: buildConfig.replace(
          "{ output: { filename: 'bundle.js' } }",
          "{ default: {resolve:{extensions:['.js'],alias:{utility:'/different'}}} }",
        ),
      },
    ],
    [
      "merged thenable export",
      {
        config: buildConfig.replace(
          "{ output: { filename: 'bundle.js' } }",
          "{ then: accept => accept({resolve:{extensions:['.js'],alias:{utility:'/different'}}}) }",
        ),
      },
    ],
    [
      "undeclared bare helper",
      { config: `const custom=require('unlisted-helper');${buildConfig}` },
    ],
    [
      "aliased bare helper declaration",
      {
        config: `const custom=require('plugin-package');${buildConfig}`,
        packageFields: {
          devDependencies: {
            webpack: "^3.10.0",
            "webpack-merge": "^4.1.1",
            "plugin-package": "npm:replacement@1.0.0",
          },
        },
      },
    ],
    [
      "dotted bare package spelling",
      {
        config: `const patch=require('.patch');const applied=patch();${buildConfig}`,
        files: {
          "node_modules/.patch/index.js": `const base=require('../../build/webpack.base');module.exports=()=>{base.resolve.alias.utility='/changed';};`,
        },
      },
    ],
    [
      "bare package traversal into an own module",
      {
        config: `const patch=require('plugin-package/../../build/patch');const applied=patch();${buildConfig}`,
        files: {
          "build/patch.js": `const base=require('./webpack.base');module.exports=()=>{base.resolve.alias.utility='/changed';};`,
        },
      },
    ],
    [
      "nested prototype object key",
      {
        config: buildConfig.replace(
          "{ output: { filename: 'bundle.js' } }",
          "{options:{__proto__:{resolve:{alias:{utility:'/different'}}}}}",
        ),
      },
    ],
    [
      "nested constructor object key",
      {
        config: buildConfig.replace(
          "{ output: { filename: 'bundle.js' } }",
          "{options:{constructor:{prototype:{resolve:{alias:{utility:'/different'}}}}}}",
        ),
      },
    ],
    [
      "unknown resolve plugin",
      { base: baseConfig.replace("extensions:", "plugins: [], extensions:") },
    ],
    [
      "missing declared extensions",
      { base: baseConfig.replace("extensions: ['.js', '.jsx'], ", "") },
    ],
    [
      "unsupported TS loader extension",
      { base: baseConfig.replace("['.js', '.jsx']", "['.ts', '.js']") },
    ],
    [
      "later alias override",
      {
        config: buildConfig.replace(
          "{ output: { filename: 'bundle.js' } }",
          "{resolve:{alias:{utility:'/wrong'}}}",
        ),
      },
    ],
    [
      "later extensions override",
      {
        config: buildConfig.replace(
          "{ output: { filename: 'bundle.js' } }",
          "{resolve:{extensions:['.jsx']}}",
        ),
      },
    ],
    [
      "overlapping alias prefixes",
      { base: baseConfig.replace("utility:", "'utility/nested':'/other', utility:") },
    ],
    [
      "different start export",
      {
        start: "webpack-dev-server --config ./scripts/start.js",
        files: {
          "scripts/start.js":
            "module.exports={resolve:{extensions:['.js'],alias:{utility:'/different'}}};",
        },
      },
    ],
    ["config import cycle", { config: `const loop=require('./build');module.exports=loop;` }],
    ["invalid selected syntax", { base: "const config = {" }],
    [
      "foreign config require",
      { config: `const foreign=require('some-config');module.exports=foreign;` },
    ],
    [
      "nested config package boundary",
      { files: { "build/package.json": JSON.stringify({ type: "module" }) } },
    ],
    [
      "unsupported direct relative alias string",
      { base: baseConfig.replace("path.resolve(__dirname, '../src/utility')", "'./src/utility'") },
    ],
  ];

  it.each(unsupported)("declines %s", (_name, options) => {
    const consumer = fixture(options);
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toBeNull();
  });

  it("shares the alias resolution with imported export lookup and the source project index", () => {
    const consumer = fixture();
    const resolved = resolveCrossFileValueExportWithFilePath(consumer, "utility/format", "format");
    expect(resolved?.filePath).toBe(path.join(temporaryDirectory, "src/utility/format.js"));
    const program = parseSourceFile(consumer);
    if (!program || !isNodeOfType(program, "Program")) throw new Error("Expected fixture program");
    const index = buildSourceProjectIndex({
      rootDirectory: temporaryDirectory,
      currentFilePath: consumer,
      currentProgramNode: program,
      currentScopes: analyzeScopes(program),
    });
    const declaration = program.body.find((statement) =>
      isNodeOfType(statement, "ImportDeclaration"),
    );
    expect(declaration && index?.resolvedSourcePathByNode.get(declaration)).toBe(
      normalizeFilename(path.join(temporaryDirectory, "src/utility/format.js")),
    );
  });

  it("records and replays config content and missing alias target probes across repeated lookups", () => {
    const consumer = fixture();
    const first = captureCrossFileProbes(() => resolveWebpackAliasPath(consumer, "utility/absent"));
    const second = captureCrossFileProbes(() =>
      resolveWebpackAliasPath(consumer, "utility/absent"),
    );
    expect(second.value).toEqual(first.value);
    expect(second.trace).toEqual(first.trace);
    for (const relativePath of ["package.json", "scripts/build.js", "build/webpack.base.js"])
      expect(first.trace.contentPaths.has(path.join(temporaryDirectory, relativePath))).toBe(true);
    expect(
      first.trace.existencePaths.has(path.join(temporaryDirectory, "src/utility/absent.js")),
    ).toBe(true);
  });

  it("invalidates a same-size config edit with restored mtime after the shared reset", () => {
    const consumer = fixture({
      files: { "src/renamed/format.js": "export const format = () => false;" },
    });
    const filename = path.join(temporaryDirectory, "build/webpack.base.js");
    const stat = fs.statSync(filename);
    expect(resolveModulePath(consumer, "utility/format")).toBe(
      path.join(temporaryDirectory, "src/utility/format.js"),
    );
    const changed = baseConfig.replace("../src/utility", "../src/renamed");
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(baseConfig));
    writeFile("build/webpack.base.js", changed);
    fs.utimesSync(filename, stat.atime, stat.mtime);
    resetFilesystemCaches();
    expect(resolveModulePath(consumer, "utility/format")).toBe(
      path.join(temporaryDirectory, "src/renamed/format.js"),
    );
  });

  it("captures missing target appearance and deletion without changing config", () => {
    const consumer = fixture();
    const target = path.join(temporaryDirectory, "src/utility/later.js");
    const before = captureCrossFileProbes(() => resolveModulePath(consumer, "utility/later"));
    expect(before.value).toBeNull();
    expect(before.trace.existencePaths.has(target)).toBe(true);
    writeFile("src/utility/later.js", "export const later = true;");
    resetFilesystemCaches();
    expect(resolveModulePath(consumer, "utility/later")).toBe(target);
    fs.unlinkSync(target);
    resetFilesystemCaches();
    expect(resolveModulePath(consumer, "utility/later")).toBeNull();
  });

  it("captures a selected config appearing and disappearing", () => {
    const consumer = fixture();
    const filename = path.join(temporaryDirectory, "scripts/build.js");
    fs.unlinkSync(filename);
    resetFilesystemCaches();
    const before = captureCrossFileProbes(() =>
      resolveWebpackAliasPath(consumer, "utility/format"),
    );
    expect(before.value).toBeNull();
    expect(before.trace.existencePaths.has(filename)).toBe(true);
    writeFile("scripts/build.js", buildConfig);
    resetFilesystemCaches();
    expect(resolveWebpackAliasPath(consumer, "utility/format")?.declared).toBe(true);
    fs.unlinkSync(filename);
    resetFilesystemCaches();
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toBeNull();
  });

  it("captures an earlier configured extension appearing and disappearing", () => {
    const consumer = fixture({ files: { "src/utility/later.jsx": "export const later = true;" } });
    const before = captureCrossFileProbes(() => resolveModulePath(consumer, "utility/later"));
    const earlier = path.join(temporaryDirectory, "src/utility/later.js");
    expect(before.value).toBe(path.join(temporaryDirectory, "src/utility/later.jsx"));
    expect(before.trace.existencePaths.has(earlier)).toBe(true);
    writeFile("src/utility/later.js", "export const later = false;");
    resetFilesystemCaches();
    expect(resolveModulePath(consumer, "utility/later")).toBe(earlier);
    fs.unlinkSync(earlier);
    resetFilesystemCaches();
    expect(resolveModulePath(consumer, "utility/later")).toBe(before.value);
  });

  it("declines a target owned by a nested package rather than applying its unknown resolver fields", () => {
    const consumer = fixture({
      files: {
        "src/utility/package.json": JSON.stringify({
          name: "nested",
          browser: { "./format.js": "./different.js" },
        }),
      },
    });
    expect(resolveWebpackAliasPath(consumer, "utility/format")).toEqual({
      declared: true,
      filePath: null,
    });
  });

  it
    .skipIf(process.platform === "win32")
    .each(["format?raw", "format#fragment", "format!loader", "format\\raw"])(
    "refuses matched resource syntax %s even if a literal file exists",
    (resource) => {
      const consumer = fixture({
        files: { [`src/utility/${resource}.js`]: "export const format = () => false;" },
      });
      expect(resolveWebpackAliasPath(consumer, `utility/${resource}`)).toEqual({
        declared: true,
        filePath: null,
      });
      expect(resolveModulePath(consumer, `utility/${resource}`)).toBeNull();
    },
  );

  it("refuses resource syntax appended directly to an exact alias", () => {
    const consumer = fixture({
      base: baseConfig
        .replace("utility:", () => "'utility$':")
        .replace("'../src/utility'", "'../src/utility/format.js'"),
    });
    for (const resource of [
      "utility?raw",
      "utility#fragment",
      "utility!loader",
      "utility\\format",
    ]) {
      expect(resolveWebpackAliasPath(consumer, resource)).toEqual({
        declared: true,
        filePath: null,
      });
    }
  });
});
