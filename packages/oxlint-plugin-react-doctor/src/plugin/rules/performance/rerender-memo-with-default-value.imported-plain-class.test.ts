import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resolveWebpackAliasPath } from "../../utils/resolve-webpack-alias-path.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { rerenderMemoWithDefaultValue } from "./rerender-memo-with-default-value.js";

interface ImportedPlainClassCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expectedWarnings: number;
  readonly declaredWebpackAlias?: string;
}

const baseProjectFiles: Readonly<Record<string, string>> = {
  "package.json":
    '{"name": "private-class-control", "private": true, "type": "module", "dependencies": {"react": "19.2.0"}}\n',
  "src/child.jsx":
    "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
  "src/app.jsx":
    "import Child from './child';\nexport const App = ({ config = {} }) => <Child config={config} />;\n",
};

const cases: ReadonlyArray<ImportedPlainClassCase> = [
  {
    name: "plain-imported-class-member-projection",
    expectedWarnings: 0,
    files: { ...baseProjectFiles },
  },
  {
    name: "pure-component",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { PureComponent } from 'react';\nexport default class Child extends PureComponent {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
      },
    },
  },
  {
    name: "should-component-update",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  shouldComponentUpdate(next) { return next.config !== this.props.config; }\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
      },
    },
  },
  {
    name: "memo-wrapped-export",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nclass Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\nexport default React.memo(Child);\n",
      },
    },
  },
  {
    name: "whole-record-forwarding",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config } = this.props; return <External config={config} />; }\n}\n",
      },
    },
  },
  {
    name: "selected-identity-read",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot data-check={this.props.config === cached} />; }\n}\n",
      },
    },
  },
  {
    name: "whole-props-escape",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot {...this.props} />; }\n}\n",
      },
    },
  },
  {
    name: "foreign-superclass",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React from 'react'; import { Component } from './foreign';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
        "src/foreign.jsx": "export class Component { shouldComponentUpdate() { return false; } }\n",
      },
    },
  },
  {
    name: "same-file-prototype-mutation",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\nChild.prototype.shouldComponentUpdate = () => false;\n",
      },
    },
  },
  {
    name: "independent-hook-dependency",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/app.jsx":
          "import { useEffect } from 'react';\nimport Child from './child';\nexport const App = ({ config = {} }) => { useEffect(() => work(), [config]); return <Child config={config} />; };\n",
      },
    },
  },
  {
    name: "missing-consumer-file",
    expectedWarnings: 1,
    files: {
      "package.json":
        '{"name": "private-class-control", "private": true, "type": "module", "dependencies": {"react": "19.2.0"}}\n',
      "src/app.jsx":
        "import Child from './child';\nexport const App = ({ config = {} }) => <Child config={config} />;\n",
    },
  },
  {
    name: "same-file-plain-function-existing-path",
    expectedWarnings: 0,
    files: {
      "package.json":
        '{"name": "private-class-control", "private": true, "type": "module", "dependencies": {"react": "19.2.0"}}\n',
      "src/app.jsx":
        "const Child = ({ config }) => <div>{config.title}</div>;\nexport const App = ({ config = {} }) => <Child config={config} />;\n",
    },
  },
  {
    name: "separate-importer-prototype-mutation",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import Child from './child';\nexport const Other = () => <Child config={{}} />;\nChild.prototype.shouldComponentUpdate = () => false;\n",
      },
    },
  },
  {
    name: "selected-export-alias-escape",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import Child from './child';\nexport const Other = () => <Child config={{}} />;\nexport const alias = Child;\n",
      },
    },
  },
  {
    name: "passive-prop-types-and-other-namespace-superclass",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react'; import PropTypes from 'prop-types';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\nChild.propTypes = { config: PropTypes.object, title: PropTypes.func.isRequired };\n",
        "src/other.jsx":
          "import React from 'react';\nexport class Ordinary extends React.Component { render() { return null; } }\n",
      },
    },
  },
  {
    name: "active-prop-types-validator-callback",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\nChild.propTypes = { config: () => { Child.prototype.shouldComponentUpdate = () => false; } };\n",
      },
    },
  },
  {
    name: "mutated-prop-types-binding",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react'; import PropTypes from 'prop-types';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\nPropTypes.object = arbitrary; Child.propTypes = { config: PropTypes.object };\n",
      },
    },
  },
  {
    name: "namespace-react-component-replacement",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import React from 'react';\nReact.Component = class { shouldComponentUpdate() { return false; } };\n",
      },
    },
  },
  {
    name: "runtime-reexport-of-selected-class",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/barrel.jsx": "export { default } from './child';\n",
      },
    },
  },
  {
    name: "nested-prop-rest-capture",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span', ...rest } = {} } = this.props; return <Slot />; }\n}\n",
      },
    },
  },
  {
    name: "unknown-computed-prototype-capability",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "Object[operation](target, key, descriptor);\n",
      },
    },
  },
  {
    name: "ordinary-external-api-and-data-read",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import clsx from 'clsx';\nexport const label = clsx(Object.keys({ title: true }));\n",
      },
    },
  },
  {
    name: "unresolved-relative-source",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "import './missing';\n",
      },
    },
  },
  {
    name: "unrelated-unknown-consumer-still-warns",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/app.jsx":
          "import Child from './child'; import Unknown from 'external-ui';\nexport const App = ({ config = {} }) => <><Child config={config} /><Unknown config={config} /></>;\n",
      },
    },
  },
  {
    name: "genuine-global-react-provider-replacement",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "React.Component = MemoBase;\n",
      },
    },
  },
  {
    name: "global-object-const-alias-react-provider-replacement",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "const browser = globalThis; const provider = browser.React; provider.Component = MemoBase;\n",
      },
    },
  },
  {
    name: "global-object-const-alias-unknown-computed-capability",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "const browser = globalThis; browser[capability](target);\n",
      },
    },
  },
  {
    name: "resolved-own-config-require",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "babel.config.esm.js": "module.exports = require('./babel.config');\n",
        "babel.config.js": "module.exports = () => ({ presets: [] });\n",
      },
    },
  },
  {
    name: "require-selected-class",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "const Child = require('./child').default; Child.prototype.shouldComponentUpdate = () => false;\n",
      },
    },
  },
  {
    name: "dynamic-require",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "require(moduleName);\n",
      },
    },
  },
  {
    name: "bare-react-require-provider",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "const React = require('react'); React.Component = MemoBase;\n",
      },
    },
  },
  {
    name: "aliased-global-require",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "const load = require; load('./child');\n",
      },
    },
  },
  {
    name: "global-object-require",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "globalThis.require('./child');\n",
      },
    },
  },
  {
    name: "create-require-loader",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('./child');\n",
      },
    },
  },
  {
    name: "unresolved-own-require",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "babel.config.esm.js": "module.exports = require('./missing-config');\n",
      },
    },
  },
  {
    name: "strict-declared-react-ts-alias-missing",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "tsconfig.json": '{"compilerOptions": {"paths": {"react": ["./missing-react"]}}}',
      },
    },
  },
  {
    name: "strict-declared-jsx-runtime-ts-alias-missing",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "tsconfig.json":
          '{"compilerOptions": {"paths": {"react/jsx-runtime": ["./missing-runtime"]}}}',
      },
    },
  },
  {
    name: "declared-react-webpack-alias-missing",
    declaredWebpackAlias: "react",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "package.json":
          '{\n  "name": "private-class-control",\n  "private": true,\n  "type": "commonjs",\n  "dependencies": {\n    "react": "19.2.0"\n  },\n  "devDependencies": {\n    "webpack": "^3.0.0",\n    "webpack-merge": "^4.0.0"\n  },\n  "scripts": {\n    "build": "webpack --config ./webpack.config.js"\n  }\n}\n',
        "webpack.config.js":
          "const path = require('path');\nmodule.exports = { resolve: { extensions: ['.js', '.jsx'], alias: { \"react\": path.resolve(__dirname, \"missing-react\") } } };\n",
      },
    },
  },
  {
    name: "declared-jsx-webpack-alias-missing",
    declaredWebpackAlias: "react/jsx-runtime",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "package.json":
          '{\n  "name": "private-class-control",\n  "private": true,\n  "type": "commonjs",\n  "dependencies": {\n    "react": "19.2.0"\n  },\n  "devDependencies": {\n    "webpack": "^3.0.0",\n    "webpack-merge": "^4.0.0"\n  },\n  "scripts": {\n    "build": "webpack --config ./webpack.config.js"\n  }\n}\n',
        "webpack.config.js":
          "const path = require('path');\nmodule.exports = { resolve: { extensions: ['.js', '.jsx'], alias: { \"react/jsx-runtime\": path.resolve(__dirname, \"missing-runtime\") } } };\n",
      },
    },
  },
  {
    name: "selected-entry-custom-jsx-pragma",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/app.jsx":
          "/** @jsx h */\nimport Child from './child';\nexport const App = ({ config = {} }) => <Child config={config} />;\n",
      },
    },
  },
  {
    name: "producer-custom-jsx-pragma",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "/** @jsxImportSource custom-jsx */\nimport React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
      },
    },
  },
  {
    name: "other-importer-custom-jsx-pragma",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "/** @jsx h */\nimport Child from './child'; export const Other = () => <Child config={{}} />;\n",
      },
    },
  },
  {
    name: "raw-object-destructured-reflection",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "const { getPrototypeOf, defineProperty } = Object; defineProperty(getPrototypeOf({}), 'Slot', { get() { observe(this); return 'span'; } });\n",
      },
    },
  },
  {
    name: "constructor-constructor-loader",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "({}).constructor.constructor('modifyProviders()')();\n",
      },
    },
  },
  {
    name: "constructor-alias-escape",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "export const Constructor = ({}).constructor;\n",
      },
    },
  },
  {
    name: "constructor-direct-call",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "const result = value.constructor();\n",
      },
    },
  },
  {
    name: "passive-constructor-logical-truthiness",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "export const isCallable = value => BooleanValue(value); const BooleanValue = value => !!(value && value.constructor && value.call && value.apply);\n",
      },
    },
  },
  {
    name: "passive-object-create-null",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "export const record = Object.create(null); export const values = Object.entries(record);\n",
      },
    },
  },
  {
    name: "object-create-nonnull",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "export const record = Object.create(sharedPrototype);\n",
      },
    },
  },
  {
    name: "method-decorator-installs-update-gate",
    expectedWarnings: 1,
    files: {
      "package.json":
        '{"name": "private-class-control", "private": true, "type": "module", "dependencies": {"react": "19.2.0"}}\n',
      "src/app.jsx":
        "import Child from './child';\nexport const App = ({ config = {} }) => <Child config={config} />;\n",
      "src/child.tsx":
        "import {Component} from 'react'; const decorate = (value, context) => { context.addInitializer(function () { this.shouldComponentUpdate = () => false; }); }; export default class Child extends Component { @decorate render() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; } }\n",
    },
  },
  {
    name: "declared-prop-types-ts-alias-missing",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "tsconfig.json": '{"compilerOptions": {"paths": {"prop-types": ["./missing-validators"]}}}',
      },
    },
  },
  {
    name: "declared-prop-types-webpack-alias-missing",
    declaredWebpackAlias: "prop-types",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "package.json":
          '{\n  "name": "private-class-control",\n  "private": true,\n  "type": "commonjs",\n  "dependencies": {\n    "react": "19.2.0"\n  },\n  "devDependencies": {\n    "webpack": "^3.0.0",\n    "webpack-merge": "^4.0.0"\n  },\n  "scripts": {\n    "build": "webpack --config ./webpack.config.js"\n  }\n}\n',
        "webpack.config.js":
          "const path = require('path');\nmodule.exports = { resolve: { extensions: ['.js', '.jsx'], alias: { \"prop-types\": path.resolve(__dirname, \"missing-validators\") } } };\n",
      },
    },
  },
  {
    name: "other-module-prop-types-validator-replacement",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import PropTypes from 'prop-types'; PropTypes.object = customValidator;\n",
      },
    },
  },
  {
    name: "other-module-prop-types-isrequired-replacement",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import PropTypes from 'prop-types'; PropTypes.object.isRequired = customValidator;\n",
      },
    },
  },
  {
    name: "other-module-prop-types-namespace-alias",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import PropTypes from 'prop-types'; const validators = PropTypes; validators.object = customValidator;\n",
      },
    },
  },
  {
    name: "other-module-prop-types-namespace-escape",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "import PropTypes from 'prop-types'; external(PropTypes);\n",
      },
    },
  },
  {
    name: "ordinary-prop-types-value-aliases-and-factories",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import PropTypes from 'prop-types'; export let dateFormat = PropTypes.any; export let dateRangeFormat = PropTypes.func; export const modes = PropTypes.oneOfType([PropTypes.func, PropTypes.array]);\n",
      },
    },
  },
  {
    name: "excluded-own-runtime-import",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "import './mutate.test.js';\n",
        "src/mutate.test.js":
          "import Child from './child'; Child.prototype.shouldComponentUpdate = () => false;\n",
      },
    },
  },
  {
    name: "selected-class-instance-ref",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/app.jsx":
          "import Child from './child';\nexport const App = ({ config = {} }) => <Child config={config} ref={instance => { if (instance) instance.shouldComponentUpdate = next => next.config !== instance.props.config; }} />;\n",
      },
    },
  },
  {
    name: "selected-class-opaque-spread-ref",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/app.jsx":
          "import Child from './child';\nexport const App = ({ config = {} }) => <Child config={config} {...extra} />;\n",
      },
    },
  },
  {
    name: "source-visible-instance-update-method-write",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "export const receive = instance => { instance.shouldComponentUpdate = () => false; };\n",
      },
    },
  },
  {
    name: "source-visible-instance-render-write",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx": "export const receive = instance => { instance.render = () => null; };\n",
      },
    },
  },
  {
    name: "ordinary-react-dom-render-read",
    expectedWarnings: 0,
    files: {
      ...baseProjectFiles,
      ...{
        "src/other.jsx":
          "import ReactDOM from 'react-dom'; export const mount = element => ReactDOM.render(element, container);\n",
      },
    },
  },
  {
    name: "computed-pattern-key-retained",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  render() { const { [\"config\"]: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
      },
    },
  },
  {
    name: "computed-render-key-retained",
    expectedWarnings: 1,
    files: {
      ...baseProjectFiles,
      ...{
        "src/child.jsx":
          "import React, { Component } from 'react';\nexport default class Child extends Component {\n  [\"render\"]() { const { config: { Slot = 'span' } = {} } = this.props; return <Slot />; }\n}\n",
      },
    },
  },
];

let directory = "";

const writeFile = (relativePath: string, source: string): string => {
  const filename = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};

const writeProject = (files: Readonly<Record<string, string>>): void => {
  for (const [relativePath, source] of Object.entries(files)) writeFile(relativePath, source);
};

const runSelected = () => {
  const filename = path.join(directory, "src/app.jsx");
  return runRule(rerenderMemoWithDefaultValue, fs.readFileSync(filename, "utf8"), { filename });
};

const collectSelected = () => {
  const filename = path.join(directory, "src/app.jsx");
  return collectCrossFileDependencyProbes({
    absoluteFilePath: filename,
    sourceText: fs.readFileSync(filename, "utf8"),
    ruleIds: ["rerender-memo-with-default-value"],
  });
};

const expectUnfingerprintableOutcome = (expectedWarnings: number): void => {
  resetFilesystemCaches();
  expect(collectSelected()).toBeNull();
  const warmResult = runSelected();
  expect(warmResult.parseErrors).toEqual([]);
  expect(warmResult.diagnostics).toHaveLength(expectedWarnings);
  expect(runSelected()).toEqual(warmResult);
  expect(collectSelected()).toBeNull();
  resetFilesystemCaches();
  expect(runSelected()).toEqual(warmResult);
  expect(collectSelected()).toBeNull();
};

beforeEach(() => {
  directory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "rd-imported-plain-class-")));
  resetFilesystemCaches();
});

afterEach(() => {
  resetFilesystemCaches();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("empty defaults passed to imported plain class member projections", () => {
  it("resolves a relative physical project filename", () => {
    writeProject(baseProjectFiles);
    const filename = path.join(directory, "src/app.jsx");
    const result = runRule(rerenderMemoWithDefaultValue, fs.readFileSync(filename, "utf8"), {
      filename: path.relative(process.cwd(), filename),
    });
    expect(result).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it.each(cases)("$name", ({ files, expectedWarnings, declaredWebpackAlias }) => {
    writeProject(files);
    if (declaredWebpackAlias) {
      expect(
        resolveWebpackAliasPath(path.join(directory, "src/app.jsx"), declaredWebpackAlias),
      ).toEqual({ declared: true, filePath: null });
    }
    const result = runSelected();
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedWarnings);
  });

  it("supports the existing JSX parser fallback for a JavaScript consumer", () => {
    writeProject(baseProjectFiles);
    fs.renameSync(path.join(directory, "src/child.jsx"), path.join(directory, "src/child.js"));
    expect(runSelected()).toEqual({ diagnostics: [], parseErrors: [] });
  });
});

describe("imported plain class dependency-cache contract", () => {
  it("rechecks a changed consumer while the selected source stays unchanged", () => {
    writeProject(baseProjectFiles);
    const selectedSource = fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8");
    const consumerSource = fs.readFileSync(path.join(directory, "src/child.jsx"), "utf8");
    expectUnfingerprintableOutcome(0);
    writeFile(
      "src/child.jsx",
      consumerSource.replace("return <Slot />;", "return <Slot value={this.props.config} />;"),
    );
    expectUnfingerprintableOutcome(1);
    writeFile("src/child.jsx", consumerSource);
    expectUnfingerprintableOutcome(0);
    expect(fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8")).toBe(selectedSource);
  });

  it("rechecks a newly appearing mutating importer and its removal", () => {
    writeProject(baseProjectFiles);
    const selectedSource = fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8");
    expectUnfingerprintableOutcome(0);
    const mutator = writeFile(
      "src/mutator.jsx",
      "import Child from './child'; Child.prototype.shouldComponentUpdate = () => false;",
    );
    expectUnfingerprintableOutcome(1);
    fs.unlinkSync(mutator);
    expectUnfingerprintableOutcome(0);
    expect(fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8")).toBe(selectedSource);
  });

  it("declines a declared React alias before, during and after target existence", () => {
    writeProject(baseProjectFiles);
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { react: ["./runtime/react"] } } }),
    );
    const selectedSource = fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8");
    expectUnfingerprintableOutcome(1);
    const provider = writeFile("runtime/react.ts", "export const Component = AlternateBase;");
    expectUnfingerprintableOutcome(1);
    fs.unlinkSync(provider);
    expectUnfingerprintableOutcome(1);
    expect(fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8")).toBe(selectedSource);
  });

  it("rechecks inherited JSX config content across equal-size equal-mtime changes", () => {
    writeProject(baseProjectFiles);
    writeFile("tsconfig.json", JSON.stringify({ extends: "./shared.json" }));
    const config = writeFile(
      "shared.json",
      JSON.stringify({ compilerOptions: { jsxImportSource: "react" } }),
    );
    const selectedSource = fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8");
    const originalConfig = fs.readFileSync(config, "utf8");
    const metadata = fs.statSync(config);
    expectUnfingerprintableOutcome(0);
    const changedConfig = originalConfig.replace("react", "other");
    expect(changedConfig.length).toBe(originalConfig.length);
    fs.writeFileSync(config, changedConfig);
    fs.utimesSync(config, metadata.atime, metadata.mtime);
    expectUnfingerprintableOutcome(1);
    fs.writeFileSync(config, originalConfig);
    fs.utimesSync(config, metadata.atime, metadata.mtime);
    expectUnfingerprintableOutcome(0);
    expect(fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8")).toBe(selectedSource);
  });

  it("rechecks resolution when a higher-priority class module appears", () => {
    writeProject(baseProjectFiles);
    const selectedSource = fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8");
    expectUnfingerprintableOutcome(0);
    const shadow = writeFile(
      "src/child.tsx",
      "import { PureComponent } from 'react'; export default class Child extends PureComponent { render() { const {config: {Slot = 'span'} = {}} = this.props; return <Slot />; } }",
    );
    expectUnfingerprintableOutcome(1);
    fs.unlinkSync(shadow);
    expectUnfingerprintableOutcome(0);
    expect(fs.readFileSync(path.join(directory, "src/app.jsx"), "utf8")).toBe(selectedSource);
  });

  it("keeps unrelated array-default imports fingerprintable", () => {
    writeProject(baseProjectFiles);
    const filename = path.join(directory, "src/app.jsx");
    const source = fs.readFileSync(filename, "utf8").replace("config = {}", "config = []");
    fs.writeFileSync(filename, source);
    expect(collectSelected()).not.toBeNull();
  });
});

describe("imported plain class current-host JSX provider", () => {
  it("retains advice when the current host has no indexed physical file", () => {
    writeProject(baseProjectFiles);
    const result = runRule(rerenderMemoWithDefaultValue, baseProjectFiles["src/app.jsx"], {
      filename: path.join(directory, "src/virtual.jsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the current host source for JSX pragmas instead of stale file bytes", () => {
    writeProject(baseProjectFiles);
    const filename = path.join(directory, "src/app.jsx");
    const physicalSource = fs.readFileSync(filename, "utf8");
    const result = runRule(rerenderMemoWithDefaultValue, "/** @jsx h */\n" + physicalSource, {
      filename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(fs.readFileSync(filename, "utf8")).toBe(physicalSource);
  });
});
