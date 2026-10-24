import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { shadcnIconButtonRequiresLabel } from "./shadcn-icon-button-requires-label.js";

interface NativeLabelCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expectedWarnings: number;
}

const nativeButton = `import { Pressable } from 'react-native';
export const Button = ({ visualTone, ...forwarded }) => <Pressable {...forwarded} />;`;
const caller = `import { Button } from './button';
export const Toolbar = () => <Button size="icon" accessibilityLabel="Expand panel"><svg /></Button>;`;
const contextButton = `import { Pressable } from 'react-native';
import { ToneContext } from './tone';
export const Button = ({ visualTone, ...forwarded }) =>
  <ToneContext value={visualTone}><Pressable {...forwarded} /></ToneContext>;`;
const contextModule = `import * as React from 'react';
const ToneContext = React.createContext(undefined);
export { ToneContext };`;
const baseFiles: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({
    name: "invented-native-label-fixture",
    private: true,
    type: "module",
    dependencies: { react: "19.2.0", "react-native": "0.83.4", expo: "55.0.0" },
  }),
  "src/button.tsx": nativeButton,
  "src/app.tsx": caller,
};

const cases: ReadonlyArray<NativeLabelCase> = [
  { name: "direct-native-rest-forwarding", files: baseFiles, expectedWarnings: 0 },
  {
    name: "renamed-native-import-and-passive-unrelated-prop-read",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable as NativeSurface } from 'react-native';
      export function Button({ visualTone, ...forwarded }) {
        return <NativeSurface disabled={forwarded.disabled} {...forwarded} />;
      }`,
    },
    expectedWarnings: 0,
  },
  {
    name: "renamed-button-import",
    files: {
      ...baseFiles,
      "src/app.tsx": caller
        .replace("{ Button }", "{ Button as Action }")
        .replaceAll("<Button", "<Action")
        .replaceAll("</Button", "</Action"),
    },
    expectedWarnings: 0,
  },
  {
    name: "own-source-directory-alias",
    files: {
      ...baseFiles,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
      "src/app.tsx": caller.replace("'./button'", "'@/button'"),
    },
    expectedWarnings: 0,
  },
  {
    name: "dot-source-directory-alias-and-declared-expo-base",
    files: {
      ...baseFiles,
      "tsconfig.json": JSON.stringify({
        extends: "expo/tsconfig.base",
        compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      }),
    },
    expectedWarnings: 0,
  },
  {
    name: "present-ordinary-expo-base-is-read",
    files: {
      ...baseFiles,
      "tsconfig.json": JSON.stringify({
        extends: "expo/tsconfig.base",
        compilerOptions: { jsx: "react-jsx" },
      }),
      "node_modules/expo/tsconfig.base.json": JSON.stringify({
        compilerOptions: { jsx: "react-native", strict: true },
      }),
    },
    expectedWarnings: 0,
  },
  {
    name: "genuine-exported-context-shorthand",
    files: { ...baseFiles, "src/button.tsx": contextButton, "src/tone.tsx": contextModule },
    expectedWarnings: 0,
  },
  {
    name: "genuine-exported-context-provider-member",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton
        .replaceAll("ToneContext value", "ToneContext.Provider value")
        .replaceAll("</ToneContext>", "</ToneContext.Provider>"),
      "src/tone.tsx": contextModule,
    },
    expectedWarnings: 0,
  },
  {
    name: "older-react-context-shorthand-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "18.3.1" }),
    },
    expectedWarnings: 1,
  },
  {
    name: "older-react-explicit-context-provider",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton
        .replaceAll("ToneContext value", "ToneContext.Provider value")
        .replaceAll("</ToneContext>", "</ToneContext.Provider>"),
      "src/tone.tsx": contextModule,
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "18.3.1" }),
    },
    expectedWarnings: 0,
  },
  {
    name: "ordinary-genuine-context-consumer",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/read-tone.tsx": `import { useContext } from 'react'; import { ToneContext } from './tone';
      export const Caption = () => { const tone = useContext(ToneContext); return <span>{tone}</span>; };`,
    },
    expectedWarnings: 0,
  },
  {
    name: "genuine-context-react-use-consumer",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/read-tone.tsx": `import * as React from 'react'; import { ToneContext } from './tone';
      export const Caption = () => { const tone = React.use(ToneContext); return <span>{tone}</span>; };`,
    },
    expectedWarnings: 0,
  },
  {
    name: "ordinary-declared-config-requires-and-environment-reads",
    files: {
      ...baseFiles,
      "metro.config.cjs": `const { getDefaultConfig } = require('expo/metro-config'); const config = getDefaultConfig(__dirname); config.transformer.minifierConfig = { drop_console: ['log'] }; module.exports = process.env.DEBUG ? config : config;`,
    },
    expectedWarnings: 0,
  },
  {
    name: "pure-own-barrel-forwarding",
    files: {
      ...baseFiles,
      "src/button.tsx": `export { Button } from './native-button';`,
      "src/native-button.tsx": nativeButton,
    },
    expectedWarnings: 0,
  },
  {
    name: "dom-wrapper-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `export const Button = ({ visualTone, ...forwarded }) => <button {...forwarded} />;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "mixed-return-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native';
      export function Button({ html, ...forwarded }) { if (html) return <button {...forwarded} />; return <Pressable {...forwarded} />; }`,
    },
    expectedWarnings: 1,
  },
  {
    name: "unknown-wrapper-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Surface } from 'external-ui';
      export const Button = ({ visualTone, ...forwarded }) => <Surface {...forwarded} />;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "dropped-label-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = () => <Pressable />;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "extracted-label-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": nativeButton.replace("visualTone,", "accessibilityLabel,"),
    },
    expectedWarnings: 1,
  },
  {
    name: "explicit-native-label-overwrite-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": nativeButton.replace(
        "{...forwarded}",
        '{...forwarded} accessibilityLabel=""',
      ),
    },
    expectedWarnings: 1,
  },
  {
    name: "native-aria-label-empty-overrides-label",
    files: {
      ...baseFiles,
      "src/button.tsx": nativeButton.replace("{...forwarded}", 'aria-label="" {...forwarded}'),
    },
    expectedWarnings: 1,
  },
  {
    name: "caller-aria-label-empty-overrides-label",
    files: {
      ...baseFiles,
      "src/app.tsx": caller.replace('size="icon"', 'size="icon" aria-label=""'),
    },
    expectedWarnings: 1,
  },
  {
    name: "native-labelled-by-overwrite-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": nativeButton.replace(
        "{...forwarded}",
        '{...forwarded} aria-labelledby="missing"',
      ),
    },
    expectedWarnings: 1,
  },
  {
    name: "empty-native-label-retains-warning",
    files: { ...baseFiles, "src/app.tsx": caller.replace("Expand panel", "") },
    expectedWarnings: 1,
  },
  {
    name: "duplicate-native-label-retains-warning",
    files: {
      ...baseFiles,
      "src/app.tsx": caller.replace('size="icon"', 'size="icon" accessibilityLabel=""'),
    },
    expectedWarnings: 1,
  },
  {
    name: "child-icon-only-label-retains-warning",
    files: {
      ...baseFiles,
      "src/app.tsx": `import { Button } from './button'; export const Toolbar = () => <Button size="icon"><MiniIcon accessibilityLabel="Expand" /></Button>;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "rest-object-escape-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = ({ visualTone, ...forwarded }) => { inspect(forwarded); return <Pressable {...forwarded} />; };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "rest-object-write-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = ({ visualTone, ...forwarded }) => { forwarded.accessibilityLabel = ''; return <Pressable {...forwarded} />; };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "rest-label-read-is-conservative-consumption",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = ({ visualTone, ...forwarded }) => { inspect(forwarded.accessibilityLabel); return <Pressable {...forwarded} />; };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "computed-rest-read-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = ({ visualTone, ...forwarded }) => { inspect(forwarded[visualTone]); return <Pressable {...forwarded} />; };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "unknown-extra-spread-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": nativeButton.replace("{...forwarded}", "{...unknown} {...forwarded}"),
    },
    expectedWarnings: 1,
  },
  {
    name: "nonliteral-return-transform-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = ({ visualTone, ...forwarded }) => transform(<Pressable {...forwarded} />);`,
    },
    expectedWarnings: 1,
  },
  {
    name: "stored-native-return-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; export const Button = ({ visualTone, ...forwarded }) => { const result = <Pressable {...forwarded} />; return result; };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "button-binding-replacement-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native'; let Button = ({ visualTone, ...forwarded }) => <Pressable {...forwarded} />; Button = ({ children }) => <button>{children}</button>; export { Button };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "native-host-namespace-replacement-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import * as Native from 'react-native'; Native.Pressable = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "native-host-reflection-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Pressable } from 'react-native'; Object.defineProperty(Pressable, 'render', { value: Fake });`,
    },
    expectedWarnings: 1,
  },
  {
    name: "canonical-native-reexport-transport-retains-warning",
    files: {
      ...baseFiles,
      "src/native-bridge.ts": `export { default as Native } from 'react-native';`,
      "src/replace-native.ts": `import { Native } from './native-bridge'; Native.Pressable = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "visible-element-type-write-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Pressable } from 'react-native'; const view = <Pressable />; view.type.render = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "visible-element-type-invocation-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Pressable } from 'react-native'; const view = <Pressable />; inspect(view.type(view.props));`,
    },
    expectedWarnings: 1,
  },
  {
    name: "returned-element-type-alias-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Button } from './button'; const host = Button({}).type; host.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "returned-element-type-destructuring-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Button } from './button'; const { type: host } = Button({}); host.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "native-element-type-destructuring-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Pressable } from 'react-native'; const { type: host } = <Pressable />; host.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "raw-button-value-escape-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import { Button } from './button'; inspect(Button);`,
    },
    expectedWarnings: 1,
  },
  {
    name: "namespace-native-host-nested-write-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import * as Native from 'react-native'; Native.Pressable.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "namespace-native-host-value-alias-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `import * as Native from 'react-native'; const Host = Native.Pressable; Host.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "excluded-imported-runtime-source-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": `import './mutate.test';\n${nativeButton}`,
      "src/mutate.test.ts": `import { Pressable } from 'react-native'; Pressable.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "unavailable-unrelated-generated-client-preserves-label-proof",
    files: { ...baseFiles, "src/button.tsx": `import './generated-client';\n${nativeButton}` },
    expectedWarnings: 0,
  },
  {
    name: "missing-selected-button-retains-warning",
    files: { "package.json": baseFiles["package.json"], "src/app.tsx": caller },
    expectedWarnings: 1,
  },
  {
    name: "missing-selected-context-retains-warning",
    files: { ...baseFiles, "src/button.tsx": contextButton },
    expectedWarnings: 1,
  },
  {
    name: "ordinary-application-tools-directory-is-indexed",
    files: {
      ...baseFiles,
      "src/app.tsx": `import './features/devtools/assist';\n${caller}`,
      "src/features/devtools/assist.ts": `export const hint = 'Ready';`,
    },
    expectedWarnings: 0,
  },
  {
    name: "static-unrelated-lazy-module-preserves-label-proof",
    files: {
      ...baseFiles,
      "src/lazy-field.ts": `export const loadField = () => import('./field');`,
      "src/field.ts": `export const value = 'Ready';`,
    },
    expectedWarnings: 0,
  },
  {
    name: "unrelated-preview-sdk-graph-preserves-label-proof",
    files: {
      ...baseFiles,
      "src/preview-route.ts": `export { default } from '../.preview';`,
      ".preview/index.ts": `export { view as default } from 'preview-sdk';`,
    },
    expectedWarnings: 0,
  },
  {
    name: "dynamic-canonical-native-import-retains-warning",
    files: { ...baseFiles, "src/load-native.ts": `void import('react-native');` },
    expectedWarnings: 1,
  },
  {
    name: "dynamic-node-loader-import-retains-warning",
    files: { ...baseFiles, "src/load-native.ts": `void import('node:module');` },
    expectedWarnings: 1,
  },
  {
    name: "opaque-dynamic-import-retains-warning",
    files: { ...baseFiles, "src/load-native.ts": `void import(runtimeSource);` },
    expectedWarnings: 1,
  },
  {
    name: "dynamic-selected-button-import-retains-warning",
    files: { ...baseFiles, "src/load-native.ts": `void import('./button');` },
    expectedWarnings: 1,
  },
  {
    name: "dynamic-selected-context-import-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/load-native.ts": `void import('./tone');`,
    },
    expectedWarnings: 1,
  },
  {
    name: "application-tools-provider-mutation-retains-warning",
    files: {
      ...baseFiles,
      "src/features/devtools/mutate.ts": `import { Pressable } from 'react-native'; Pressable.compare = () => true;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "module-require-provider-transport-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.cjs": `const Native = module.require('react-native'); Native.Pressable = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "process-builtin-provider-transport-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.cjs": `const loader = process.getBuiltinModule('module').createRequire(__filename); loader('react-native').Pressable = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "erased-node-loader-binding-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.ts": `declare const module: any; const Native = module.require('react-native'); Native.Pressable = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "canonical-native-require-retains-warning",
    files: {
      ...baseFiles,
      "src/replace-native.tsx": `const Native = require('react-native'); Native.Pressable = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "fake-context-name-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": `export const ToneContext = ({ children }) => <section>{children}</section>;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "context-provider-replacement-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/replace-tone.tsx": `import { ToneContext } from './tone'; ToneContext.Provider = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "context-escape-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/replace-tone.tsx": `import { ToneContext } from './tone'; inspect(ToneContext);`,
    },
    expectedWarnings: 1,
  },
  {
    name: "context-default-alias-consumer-write-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule.replace(
        "export { ToneContext };",
        "export { ToneContext, ToneContext as default };",
      ),
      "src/replace-tone.tsx": `import Tone from './tone'; Tone.Provider = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "context-commonjs-consumer-write-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/replace-tone.cjs": `const { ToneContext } = require('./tone'); ToneContext.Provider = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "custom-context-attribute-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton.replace(
        "value={visualTone}",
        "value={visualTone} {...unknown}",
      ),
      "src/tone.tsx": contextModule,
    },
    expectedWarnings: 1,
  },
  {
    name: "custom-react-provider-replacement-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/replace-react.tsx": `import * as React from 'react'; React.createContext = fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "type-only-native-host-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": nativeButton.replace("import { Pressable }", "import type { Pressable }"),
    },
    expectedWarnings: 1,
  },
  {
    name: "type-only-context-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton.replace(
        "import { ToneContext }",
        "import type { ToneContext }",
      ),
      "src/tone.tsx": contextModule,
    },
    expectedWarnings: 1,
  },
  {
    name: "missing-canonical-native-remap-retains-warning",
    files: {
      ...baseFiles,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "react-native": ["./missing-native"] } },
      }),
    },
    expectedWarnings: 1,
  },
  {
    name: "resolved-canonical-react-remap-retains-warning",
    files: {
      ...baseFiles,
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { react: ["./fake-react"] } } }),
      "fake-react.ts": `export const createContext = () => Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "present-expo-base-remap-is-not-bypassed",
    files: {
      ...baseFiles,
      "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base" }),
      "node_modules/expo/tsconfig.base.json": JSON.stringify({
        compilerOptions: { jsxImportSource: "other-runtime" },
      }),
    },
    expectedWarnings: 1,
  },
  {
    name: "unknown-missing-extends-retains-warning",
    files: { ...baseFiles, "tsconfig.json": JSON.stringify({ extends: "unknown/tsconfig.base" }) },
    expectedWarnings: 1,
  },
  {
    name: "missing-expo-without-declaration-retains-warning",
    files: {
      ...baseFiles,
      "package.json": JSON.stringify({
        private: true,
        dependencies: { react: "19.2.0", "react-native": "0.83.4" },
      }),
      "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base" }),
    },
    expectedWarnings: 1,
  },
  {
    name: "custom-jsx-pragma-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": "/** @jsxImportSource other-runtime */\n" + nativeButton,
    },
    expectedWarnings: 1,
  },
  {
    name: "metro-resolver-customization-retains-warning",
    files: {
      ...baseFiles,
      "metro.config.cjs": `const config = {}; config.resolver = { extraNodeModules: { 'react-native': './fake' } }; module.exports = config;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "custom-babel-config-retains-warning",
    files: {
      ...baseFiles,
      "babel.config.cjs": `module.exports = { plugins: [['custom-jsx', { pragma: 'other' }]] };`,
    },
    expectedWarnings: 1,
  },
  {
    name: "hidden-babelrc-retains-warning",
    files: { ...baseFiles, ".babelrc": JSON.stringify({ plugins: ["custom-jsx"] }) },
    expectedWarnings: 1,
  },
  {
    name: "unknown-metro-config-extension-retains-warning",
    files: {
      ...baseFiles,
      "metro.config.cjs": `const patch = require('opaque-native-config'); module.exports = patch({});`,
    },
    expectedWarnings: 1,
  },
  {
    name: "ambiguous-native-button-sidecar-retains-warning",
    files: {
      ...baseFiles,
      "src/button.native.tsx": `export const Button = ({ children }) => <button>{children}</button>;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "ambiguous-ios-button-sidecar-retains-warning",
    files: {
      ...baseFiles,
      "src/button.ios.tsx": `export const Button = ({ children }) => <button>{children}</button>;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "ambiguous-android-button-sidecar-retains-warning",
    files: {
      ...baseFiles,
      "src/button.android.tsx": `export const Button = ({ children }) => <button>{children}</button>;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "ambiguous-web-button-sidecar-retains-warning",
    files: {
      ...baseFiles,
      "src/button.web.tsx": `export const Button = ({ children }) => <button>{children}</button>;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "ambiguous-context-sidecar-retains-warning",
    files: {
      ...baseFiles,
      "src/button.tsx": contextButton,
      "src/tone.tsx": contextModule,
      "src/tone.native.jsx": `export const ToneContext = Fake;`,
    },
    expectedWarnings: 1,
  },
  {
    name: "child-transform-does-not-consume-root-label",
    files: {
      ...baseFiles,
      "src/button.tsx": `import { Pressable } from 'react-native';
      export function Button({ children, ...forwarded }) { const content = transform(children); return <Pressable {...forwarded}>{content}</Pressable>; }`,
    },
    expectedWarnings: 0,
  },
];

let temporaryDirectory: string;
const writeFiles = (files: Readonly<Record<string, string>>): void => {
  for (const [relativePath, text] of Object.entries(files)) {
    const filename = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, text);
  }
};
const inspect = (filename = path.join(temporaryDirectory, "src/app.tsx")) =>
  runRule(
    shadcnIconButtonRequiresLabel,
    fs.readFileSync(path.join(temporaryDirectory, "src/app.tsx"), "utf8"),
    { filename, settings: { "react-doctor": { rootDirectory: temporaryDirectory } } },
  );

beforeEach(() => {
  temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "native-label-proof-")));
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("native icon Button label forwarding", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      writeFiles(testCase.files);
      const result = inspect();
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedWarnings);
    });
  }
  it("normalizes a relative current filename before matching the host Program", () => {
    writeFiles(baseFiles);
    expect(
      inspect(path.relative(process.cwd(), path.join(temporaryDirectory, "src/app.tsx")))
        .diagnostics,
    ).toHaveLength(0);
  });
  it("refuses a missing host file even when its import could resolve", () => {
    writeFiles(baseFiles);
    expect(inspect(path.join(temporaryDirectory, "src/missing.tsx")).diagnostics).toHaveLength(1);
  });
  it("never fingerprints successful or failed syntactic native-label candidates", () => {
    writeFiles(baseFiles);
    const filename = path.join(temporaryDirectory, "src/app.tsx");
    for (const buttonSource of [
      nativeButton,
      `export const Button = ({ children }) => <button>{children}</button>;`,
      nativeButton,
    ]) {
      fs.writeFileSync(path.join(temporaryDirectory, "src/button.tsx"), buttonSource);
      expect(
        collectCrossFileDependencyProbes({
          absoluteFilePath: filename,
          sourceText: caller,
          ruleIds: ["shadcn-icon-button-requires-label"],
        }),
      ).toBeNull();
      const warm = inspect();
      resetFilesystemCaches();
      const fresh = inspect();
      expect(warm).toEqual(fresh);
    }
  });
});
