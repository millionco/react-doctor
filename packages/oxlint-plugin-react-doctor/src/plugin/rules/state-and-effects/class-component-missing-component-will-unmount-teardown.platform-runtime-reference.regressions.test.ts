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

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "Keyboard-direct",
      prefix: "const rewriteProvider=()=>{ mutate(Keyboard);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "Keyboard-interface",
      prefix:
        "const rewriteProvider=()=>{interface Keyboard {} mutate(Keyboard);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "Keyboard-typealias",
      prefix:
        "const rewriteProvider=()=>{type Keyboard=unknown; mutate(Keyboard);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "Platform-direct",
      prefix: "const rewriteProvider=()=>{ mutate(Platform);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "Platform-interface",
      prefix:
        "const rewriteProvider=()=>{interface Platform {} mutate(Platform);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "Platform-typealias",
      prefix:
        "const rewriteProvider=()=>{type Platform=unknown; mutate(Platform);}; rewriteProvider();",
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
