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

describe("class-component-missing-component-will-unmount-teardown erased providers", () => {
  it.each([
    { prefix: "", expected: 0 },
    {
      prefix:
        "globalThis.require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      prefix:
        "declare const globalThis: any; globalThis.require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      prefix:
        "interface globalThis {} globalThis.require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.require('react-native').Keyboard.addListener = () => ({remove: () => {}});",
      expected: 1,
    },
    { prefix: "declare const globalThis: unknown;", expected: 0 },
    { prefix: "interface globalThis {}", expected: 0 },
    { prefix: 'import type globalThis from "carrier";', expected: 0 },
  ])("preserves provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      prefix + "\n" + source,
      options,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
