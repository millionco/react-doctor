import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const source =
  '// rule: class-component-missing-component-will-unmount-teardown\n// verdict: pass\n// weakness: control-flow\n\nimport React from "react";\nimport { Keyboard, Platform } from "react-native";\nclass ListenerPanel extends React.Component {\n  componentDidMount() {\n    Platform.OS === "ios" && this.acquire();\n  }\n  componentWillUnmount() {\n    Platform.OS === "ios" && this.release();\n  }\n  acquire() {\n    this.subscription = Keyboard.addListener("change", () => {});\n  }\n  release() {\n    this.subscription.remove();\n  }\n  render() {\n    return null;\n  }\n}\n';
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
      prefix: "require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      name: "type-import-equals",
      prefix:
        "import type require = require('provider-types'); require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({Keyboard: {addListener: () => ({remove: () => {}})}}); require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({Keyboard: {addListener: () => ({remove: () => {}})}}); interface require {} require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({Keyboard: {addListener: () => ({remove: () => {}})}}); require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({Keyboard: {addListener: () => ({remove: () => {}})}}); function localLoader() { interface require {} require('react-native').Keyboard.addListener = () => ({remove: () => {}}); }",
      expected: 1,
    },
    {
      name: "value-import-equals",
      prefix:
        "import require = require('provider-types'); require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
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
