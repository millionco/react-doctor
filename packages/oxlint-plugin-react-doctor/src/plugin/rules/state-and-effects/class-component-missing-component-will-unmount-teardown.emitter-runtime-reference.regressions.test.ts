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

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "DeviceEventEmitter-direct",
      prefix: "const rewriteProvider=()=>{ mutate(DeviceEventEmitter);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "DeviceEventEmitter-interface",
      prefix:
        "const rewriteProvider=()=>{interface DeviceEventEmitter {} mutate(DeviceEventEmitter);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "DeviceEventEmitter-typealias",
      prefix:
        "const rewriteProvider=()=>{type DeviceEventEmitter=unknown; mutate(DeviceEventEmitter);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "React-direct",
      prefix: "const rewriteProvider=()=>{ mutate(React);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "React-interface",
      prefix: "const rewriteProvider=()=>{interface React {} mutate(React);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "React-typealias",
      prefix: "const rewriteProvider=()=>{type React=unknown; mutate(React);}; rewriteProvider();",
      expected: 1,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(
      classComponentMissingComponentWillUnmountTeardown,
      prefix + "\n" + source,
      options,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
