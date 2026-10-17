import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const source =
  '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: library-idiom\n// source: independent synthetic native-emitter cleanup regression\n// verdict: pass\n\nimport * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() {\n    this.subscription = DeviceEventEmitter.addListener("change", this.handleChange);\n  }\n  componentWillUnmount() {\n    if (this.subscription) {\n      this.subscription.remove();\n    }\n  }\n  render() {\n    return null;\n  }\n}\n';
const options = {
  filename: "/project/src/view.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "vite",
      capabilities: ["react", "nextjs", "r3f", "react-native"],
    },
    react: { version: "19.0.0" },
  },
};

describe("class-component-missing-component-will-unmount-teardown runtime provider bindings", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "direct",
      prefix: "require('react-native').DeviceEventEmitter.addListener = () => ({});",
      expected: 1,
    },
    {
      name: "type-import-equals",
      prefix:
        "import type require = require('provider-types'); require('react-native').DeviceEventEmitter.addListener = () => ({});",
      expected: 1,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({DeviceEventEmitter: {addListener: () => ({})}}); require('react-native').DeviceEventEmitter.addListener = () => ({});",
      expected: 0,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({DeviceEventEmitter: {addListener: () => ({})}}); interface require {} require('react-native').DeviceEventEmitter.addListener = () => ({});",
      expected: 0,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({DeviceEventEmitter: {addListener: () => ({})}}); require('react-native').DeviceEventEmitter.addListener = () => ({});",
      expected: 0,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({DeviceEventEmitter: {addListener: () => ({})}}); function localLoader() { interface require {} require('react-native').DeviceEventEmitter.addListener = () => ({}); }",
      expected: 0,
    },
    {
      name: "value-import-equals",
      prefix:
        "import require = require('provider-types'); require('react-native').DeviceEventEmitter.addListener = () => ({});",
      expected: 1,
    },
  ])("preserves runtime binding: $name", ({ prefix, expected }) => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      prefix + "\n" + source,
      options,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
