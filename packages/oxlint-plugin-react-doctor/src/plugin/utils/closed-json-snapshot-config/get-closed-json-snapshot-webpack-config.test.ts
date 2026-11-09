import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { getClosedJsonSnapshotSourceResolutionPolicy } from "./get-closed-json-snapshot-webpack-config.js";

let rootDirectory: string;
const writeFile = (filename: string, source: string): void => {
  const absolutePath = path.join(rootDirectory, filename);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, source);
};
beforeEach(() => {
  rootDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-source-config-")),
  );
  writeFile("package.json", "{}");
});
afterEach(() => fs.rmSync(rootDirectory, { recursive: true, force: true }));

describe("demanded source resolution projection", () => {
  const readSourcePolicy = () =>
    getClosedJsonSnapshotSourceResolutionPolicy({
      rootDirectory,
      configFilePath: path.join(rootDirectory, "webpack.config.js"),
    });
  it.each([
    [".js", ".jsx", ".css", ".less"],
    [".less", ".css", ".js"],
  ])("preserves the complete mixed source and style extension list: %j", (...extensions) => {
    writeFile(
      "webpack.config.js",
      `module.exports={resolve:{extensions:${JSON.stringify(extensions)}}};`,
    );
    expect(readSourcePolicy()?.extensions).toEqual(extensions);
  });
  it.each([
    [".js", ".scss"],
    [".css", ".js", ".css"],
  ])("holds unsupported or duplicate extension candidates: %j", (...extensions) => {
    writeFile(
      "webpack.config.js",
      `module.exports={resolve:{extensions:${JSON.stringify(extensions)}}};`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("keeps opaque constructor fields and incidental identifier names outside resolver demand", () => {
    writeFile(
      "webpack.config.js",
      `const path=require('path'); const Html=require('unknown-html'); module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/client')}},plugins:[new Html({path:'literal', template:path.resolve(__dirname,'public/index.html')})],module:{rules:unknownAssets()},output:unknownOutput()};`,
    );
    expect(readSourcePolicy()?.aliases).toEqual([
      { name: "client", exact: false, targetAbsolutePath: path.join(rootDirectory, "src/client") },
    ]);
  });
  it("projects the ordinary merged config with namespace and imported plugin constructors", () => {
    writeFile(
      "base.js",
      `const path=require('path');module.exports={resolve:{extensions:['.js','.jsx','.json'],alias:{'@':path.resolve(__dirname,'src')}}};`,
    );
    writeFile(
      "entries.js",
      `const path=require('path');const Html=require('html-webpack-plugin');module.exports={entry:path.resolve(__dirname,'src/index.js'),plugins:[new Html({template:path.resolve(__dirname,'public/index.html')})]};`,
    );
    writeFile(
      "webpack.config.js",
      `const merge=require('webpack-merge');const webpack=require('webpack');const base=require('./base');const entries=require('./entries');module.exports=merge(base,entries,{plugins:[new webpack.DefinePlugin({'process.env.NODE_ENV':'"production"'})]});`,
    );
    expect(readSourcePolicy()?.aliases).toEqual([
      { name: "@", exact: false, targetAbsolutePath: path.join(rootDirectory, "src") },
    ]);
    expect(readSourcePolicy()?.configFilePaths).toHaveLength(3);
  });
  it.each([
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve('path'))]};`,
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin({use:[{loader:require.resolve('synthetic-loader')}]})]};`,
    `const Plugin=require('compiler-plugin');const development=process.env.NODE_ENV==='development';module.exports={entry:development?'./dev':'./prod',resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve('path'))]};`,
    `const Plugin=require('compiler-plugin');const unused={process:'literal',global:'literal',globalThis:'literal',Function:'literal',constructor:'literal'};module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve('path'))]};`,
    `const Plugin=require('compiler-plugin');const options={};const unused=options['safe'];module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve('path'),JSON.stringify('literal'))]};`,
  ])("keeps native resolver filenames opaque without loading their targets", (source) => {
    writeFile("webpack.config.js", source);
    expect(readSourcePolicy()?.extensions).toEqual([".js"]);
  });
  it.each([
    `module.exports={context:require.resolve('path'),resolve:{extensions:['.js']}};`,
    `module.exports={resolve:{extensions:['.js'],alias:{client:require.resolve('path')}}};`,
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require['resolve']('path'))]};`,
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve?.('path'))]};`,
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require?.resolve('path'))]};`,
    `const Plugin=require('compiler-plugin');const name='path';module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve(name))]};`,
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve('path',{paths:[]}))]};`,
    `const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve(...['path']))]};`,
    `const Plugin=require('compiler-plugin');const resolve=require.resolve;module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(resolve('path'))]};`,
  ])("refuses unresolved or demanded resolver results", (source) => {
    writeFile("webpack.config.js", source);
    expect(readSourcePolicy()).toBeNull();
  });
  it.each([
    `const unused=require('module');`,
    `const unused=require('node:module');`,
    `const unused=require('vm');`,
    `const unused=require('node:process');`,
    `const unused=process.getBuiltinModule('module');`,
    `const unused=globalThis.process;`,
    `const unused=new Function('return process');`,
    `const object={};const unused=Reflect.get(object,'constructor');`,
    `const unused=Object.getPrototypeOf('literal');`,
    `const unused=({}).constructor;`,
    `const unused=({})['constructor'];`,
    `const object={};const key='safe';const unused=object[key];`,
    `const load=require;`,
    `const moduleName='module';const unused=require(moduleName);`,
    `const unused=process.env;`,
    `const unused=(process.env.NODE_ENV='production');`,
    `const unused=delete process.env.NODE_ENV;`,
    `const ignored=()=>process.env.NODE_ENV;`,
    `function ignored(){return 'literal';}`,
    `const unused={get value(){return 'literal';}};`,
    `const Ignored=class {};`,
    `class Ignored {}`,
    `const unused=import('node:module');`,
    `const unused=this;`,
  ])("holds unsupported visible scope beside a native resolver filename", (prefix) => {
    writeFile(
      "webpack.config.js",
      `${prefix}const Plugin=require('compiler-plugin');module.exports={resolve:{extensions:['.js']},plugins:[new Plugin(require.resolve('path'))]};`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("holds local function publication in a separately demanded config module", () => {
    writeFile(
      "base.js",
      `const policy={extensions:['.js']};function require(){}function configure(value){value.resolve=()=>policy;}const setup=configure(require);function Plugin(value){value.extensions.push('.jsx');}const unused=new Plugin(require.resolve('path'));module.exports={resolve:policy};`,
    );
    writeFile(
      "webpack.config.js",
      `const base=require('./base');const unused=require.resolve('path');module.exports=base;`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("holds ignored relative imports only when using the native resolver scalar role", () => {
    writeFile("ignored.js", `module.exports={};`);
    const baseline = `const ignored=require('./ignored');module.exports={resolve:{extensions:['.js']}};`;
    writeFile("webpack.config.js", baseline);
    expect(readSourcePolicy()?.extensions).toEqual([".js"]);
    writeFile("webpack.config.js", `const filename=require.resolve('path');${baseline}`);
    expect(readSourcePolicy()).toBeNull();
  });
  it("reads demanded relative config values before accepting a native resolver filename", () => {
    writeFile("base.js", `module.exports={resolve:{extensions:['.js']}};`);
    writeFile(
      "webpack.config.js",
      `const base=require('./base');const unused=require.resolve('path');module.exports=base;`,
    );
    expect(readSourcePolicy()?.extensions).toEqual([".js"]);
  });
  it("checks modeled provider mutations learned after resolving the context", () => {
    writeFile("later.js", `module.exports=['.js'];`);
    writeFile(
      "webpack.config.js",
      `const path=require('path');const extensions=require('./later');const unused=require.resolve('path');module.exports={context:path.resolve(__dirname,'.'),resolve:{extensions}};`,
    );
    expect(readSourcePolicy()?.extensions).toEqual([".js"]);
    writeFile(
      "later.js",
      `const path=require('node:path');const replacement=require('replacement-resolver');const ignored=(path.resolve=replacement);module.exports=['.js'];`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("holds tagged-template publication beside a native resolver filename", () => {
    writeFile(
      "webpack.config.js",
      "const tag=require('compiler-tag');const policy={extensions:['.js']};const ignored=tag`${policy}`;const filename=require.resolve('path');module.exports={resolve:policy};",
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("checks late publication of a previously resolved configuration module", () => {
    writeFile(
      "base.js",
      `const path=require('path');module.exports={context:path.resolve(__dirname,'.')};`,
    );
    writeFile("late.js", `module.exports=['.js'];`);
    writeFile(
      "webpack.config.js",
      `const merge=require('webpack-merge');const base=require('./base');const extensions=require('./late');const filename=require.resolve('path');module.exports=merge(base,{resolve:{extensions}});`,
    );
    expect(readSourcePolicy()?.extensions).toEqual([".js"]);
    writeFile(
      "late.js",
      `const Plugin=require('compiler-plugin');const ignored=new Plugin(require('./base'));module.exports=['.js'];`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("does not poison require for an unrelated compiler module argument", () => {
    writeFile(
      "webpack.config.js",
      `const path=require('path');const Plugin=require('plugin');module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/client')}},plugins:[new Plugin(require('compiler-only-options'))]};`,
    );
    expect(readSourcePolicy()).not.toBeNull();
  });
  it("retains known required module capability publication through a repeated native require", () => {
    writeFile(
      "webpack.config.js",
      `const path=require('path');const Plugin=require('plugin');module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/client')}},plugins:[new Plugin(require('node:path'))]};`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it.each([
    `function require(){return foreignResolution;}module.exports=require('./base');`,
    `function require(){return foreignPath;}const path=require('path');module.exports={resolve:{alias:{client:path.resolve(__dirname,'src')}}};`,
    `class require{}module.exports=require('./base');`,
    `function module(){}module.exports={resolve:{}};`,
    `class module{}module.exports={resolve:{}};`,
    `function exports(){}module.exports=exports;`,
    `function __dirname(){}const path=require('path');module.exports={resolve:{alias:{client:path.resolve(__dirname,'src')}}};`,
    `var path=require('path');function path(){}module.exports={resolve:{alias:{client:path.resolve(__dirname,'src')}}};`,
    `var merge=require('webpack-merge');function merge(){}module.exports=merge(require('./base'),{});`,
    `function JSON(){}const base={alias:{}};module.exports={resolve:base,plugins:[new Plugin(JSON.stringify(base))]};`,
    `const path=require('path');const base={alias:{}};module.exports={resolve:base,plugins:[new Plugin(path=>path.resolve(base,'src'))]};`,
  ])("holds demanded configuration binding shadows without executing them", (source) => {
    writeFile("base.js", `module.exports={resolve:{}};`);
    writeFile("webpack.config.js", source);
    expect(readSourcePolicy()).toBeNull();
  });
  it("keeps unused local CommonJS names out of demanded implicit binding facts", () => {
    writeFile(
      "webpack.config.js",
      `function require(){return opaque;}function exports(){}module.exports={resolve:{}};`,
    );
    expect(readSourcePolicy()).not.toBeNull();
  });
  it("does not confuse shadowed callback parameters with root bindings", () => {
    writeFile(
      "webpack.config.js",
      `const path=require('path'); const Plugin=require('unknown'); module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/client')}},plugins:[new Plugin(path=>path)]};`,
    );
    expect(readSourcePolicy()).not.toBeNull();
  });
  it("resolves only required config module fields through the existing merge evaluator", () => {
    writeFile(
      "base.js",
      `const path=require('path'); module.exports={context:path.resolve(__dirname,'.'),resolve:{extensions:['.jsx','.js'],alias:{client:path.resolve(__dirname,'src/client')}},plugins:[new Opaque()]};`,
    );
    writeFile(
      "webpack.config.js",
      `const merge=require('webpack-merge');const base=require('./base');const unused=require('./unrelated-source');module.exports=merge(base,{plugins:[new Unknown()],entry:unknownEntry()});`,
    );
    writeFile("unrelated-source.js", `globalThis.sourceWriter=true;`);
    expect(new Set(readSourcePolicy()?.configFilePaths)).toEqual(
      new Set([path.join(rootDirectory, "base.js"), path.join(rootDirectory, "webpack.config.js")]),
    );
  });
  it.each([
    `JSON.parse=foreign;module.exports={resolve:{}};`,
    `const ReactDOM=require('react-dom');ReactDOM.render(element,target);module.exports={resolve:{}};`,
  ])("does not classify an imported runtime-effect module as configuration data", (source) => {
    writeFile("base.js", source);
    writeFile(
      "webpack.config.js",
      `const merge=require('webpack-merge');const base=require('./base');module.exports=merge(base,{});`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it("holds a required config object escaped through a repeated require", () => {
    writeFile("base.js", `module.exports={resolve:{}};`);
    writeFile(
      "webpack.config.js",
      `const merge=require('webpack-merge');const base=require('./base');const Plugin=require('foreign');module.exports=merge(base,{plugins:[new Plugin(require('./base'))]});`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it.each([
    `const base={alias:{}}; unknown(base); module.exports={resolve:base};`,
    `const path=require('path');const base={alias:{}};path.unknownMutator(base);module.exports={resolve:base};`,
    `const base={alias:{}};new Foreign(base);module.exports={resolve:base};`,
    `const base={alias:{}};const alias=base;alias.extensions=['.jsx'];module.exports={resolve:base};`,
    `const base={alias:{}};Object.assign(base,{alias:unknown()});module.exports={resolve:base};`,
    `module.exports={resolve:{}};module.exports.resolve.alias=unknown();`,
    `module.exports={context:unknownContext(),resolve:{}};`,
    `module.exports={resolve:unknownResolution()};`,
    `const path=require('path');path.resolve=foreign;module.exports={resolve:{alias:{client:path.resolve(__dirname,'src/client')}}};`,
    `const path=require('path');module.exports={resolve:{alias:{client:unknownTarget()}}};`,
    `const path=require('path');module.exports={resolve:{alias:{client:path.resolve(__dirname,'src'), 'client/nested':path.resolve(__dirname,'other')}}};`,
  ])("holds unknown or mutated required resolver values", (source) => {
    writeFile("webpack.config.js", source);
    expect(readSourcePolicy()).toBeNull();
  });
  it.each(["react", "react-dom", "axios", "react-router-dom", "react-router"])(
    "refuses known source API origin replacement: %s",
    (name) => {
      writeFile(
        "webpack.config.js",
        `const path=require('path');module.exports={resolve:{alias:{'${name}':path.resolve(__dirname,'src/replacement')}}};`,
      );
      expect(readSourcePolicy()).toBeNull();
    },
  );
  it.each([
    "object-assign",
    "history",
    "scheduler",
    "prop-types",
    "loose-envify",
    "react-is",
    "js-tokens",
    "invariant",
    "warning",
    "hoist-non-react-statics",
    "path-to-regexp",
    "resolve-pathname",
    "value-equal",
    "tiny-invariant",
    "tiny-warning",
    "mini-create-react-context",
    "@babel/runtime",
    "is-buffer",
  ])("holds known SDK dependency-head source aliases: %s", (name) => {
    writeFile(
      "webpack.config.js",
      `const path=require('path');module.exports={resolve:{alias:{'${name}':path.resolve(__dirname,'src/replacement')}}};`,
    );
    expect(readSourcePolicy()).toBeNull();
    writeFile(
      "webpack.config.js",
      `const path=require('path');module.exports={resolve:{alias:{'${name}/internal':path.resolve(__dirname,'src/replacement')}}};`,
    );
    expect(readSourcePolicy()).toBeNull();
  });
  it.each([
    "object",
    "history-view",
    "scheduler-view",
    "prop-types-view",
    "react-is-view",
    "utils",
  ])("keeps distinct source alias request heads distinct: %s", (name) => {
    writeFile(
      "webpack.config.js",
      `const path=require('path');module.exports={resolve:{alias:{'${name}':path.resolve(__dirname,'src/local')}}};`,
    );
    expect(readSourcePolicy()?.aliases[0]?.name).toBe(name);
  });
  it.each([{ pragma: "h" }, { importSource: "custom-runtime" }])(
    "holds direct inline Babel-loader JSX convention overrides",
    (options) => {
      writeFile(
        "webpack.config.js",
        `module.exports={resolve:{},module:{rules:[{loader:'babel-loader',options:${JSON.stringify(options)}}]}};`,
      );
      expect(readSourcePolicy()).toBeNull();
    },
  );
  it("holds visible custom JSX options without attesting unrelated loader options", () => {
    writeFile(
      "webpack.config.js",
      `module.exports={module:{rules:[{loader:'babel-loader',options:{presets:[['react',{pragma:'h'}]]}}]},resolve:{}};`,
    );
    expect(readSourcePolicy()).toBeNull();
    writeFile(
      "webpack.config.js",
      `module.exports={module:{rules:[{loader:'babel-loader',options:{presets:[['react',{pragma:'React.createElement'}]],plugins:['unknown']}}]},resolve:{}};`,
    );
    expect(readSourcePolicy()).not.toBeNull();
  });
});
