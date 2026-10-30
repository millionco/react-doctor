import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const cases = [
  {
    index: 0,
    name: "canonical-presence-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 1,
    name: "canonical-direct-remove",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { this.subscription.remove(); }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 2,
    name: "canonical-named-import-alias",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter as NativeEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = NativeEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 3,
    name: "missing-remove",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() {  }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 4,
    name: "wrong-field",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null; other = null; handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.other) { this.other.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 5,
    name: "wrong-instance",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (other.subscription) { other.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 6,
    name: "field-overwrite",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); this.subscription = replacement; }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 7,
    name: "duplicate-acquisition",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 8,
    name: "null-before-presence-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { this.subscription = null; if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 9,
    name: "opposite-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (!this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 10,
    name: "null-equality-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription === null) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 11,
    name: "unrelated-condition",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.props.enabled) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 12,
    name: "nested-conditional-cleanup",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { if (this.props.enabled) this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 13,
    name: "foreign-provider",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "other-library";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 14,
    name: "type-only-provider-declaration",
    code: 'import * as React from "react";\nimport type { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 15,
    name: "type-only-provider-specifier",
    code: 'import * as React from "react";\nimport { type DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 16,
    name: "local-lookalike-provider",
    code: 'import * as React from "react";\nconst DeviceEventEmitter = foreignEmitter;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 17,
    name: "provider-method-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nDeviceEventEmitter.addListener = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 18,
    name: "provider-argument-escape",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconsume(DeviceEventEmitter);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 19,
    name: "provider-alias-escape",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconst alias = DeviceEventEmitter; consume(alias);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 20,
    name: "namespace-provider-carrier",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport * as Native from "react-native";\nconsume(Native);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 21,
    name: "default-provider-carrier",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport Native from "react-native";\nconsume(Native);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 22,
    name: "type-only-carrier-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport type * as NativeTypes from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 23,
    name: "subscription-escape",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); consume(this.subscription); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 24,
    name: "subscription-remove-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); this.subscription.remove = replacement; }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 25,
    name: "whole-instance-escape",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); consume(this); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 26,
    name: "generator-cleanup",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  *componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 27,
    name: "async-cleanup",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  async componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 28,
    name: "deferred-cleanup",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { queueMicrotask(() => { if (this.subscription) { this.subscription.remove(); } }); }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 29,
    name: "unknown-prelude",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { unknownWork(); if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 30,
    name: "throwing-prelude",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { throw new Error("stop"); if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 31,
    name: "ordinary-other-remove-prelude",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null; other = null; handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.other) { this.other.remove(); } if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 32,
    name: "earlier-Device-later-opaque-BackHandler",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport { BackHandler } from "./opaque-back-handler";\nexport class Example extends React.Component {\n  subscription = null; other = null; handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); this.other = BackHandler.addEventListener("back", this.handleChange); }\n  componentWillUnmount() { if (this.other) { this.other.remove(); } if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 33,
    name: "genuine-reflection-exposure",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nReflect.set(DeviceEventEmitter, "addListener", replacement);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 34,
    name: "genuine-dynamic-eval-exposure",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\neval("DeviceEventEmitter.addListener = replacement");\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 35,
    name: "shadowed-reflection-name",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconst Reflect = { note() {} }; Reflect.note();\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 36,
    name: "conditional-acquisition",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { if (this.props.enabled) { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); } }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 37,
    name: "optional-remove",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { this.subscription?.remove(); }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 38,
    name: "field-accessor",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  get subscription() { return foreignHandle; }\n  set subscription(value) {}\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 39,
    name: "duplicate-lifecycle",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\ncomponentWillUnmount() {}\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 40,
    name: "second-named-runtime-Device-carrier",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport { DeviceEventEmitter as OtherEmitter } from "react-native"; OtherEmitter.addListener = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 41,
    name: "second-named-type-only-Device-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport { type DeviceEventEmitter as OtherEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 42,
    name: "unrelated-named-native-import-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport { View } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 43,
    name: "runtime-literal-native-dynamic-import",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport("react-native").then(native => { native.DeviceEventEmitter.addListener = replacement; });\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 44,
    name: "runtime-unknown-dynamic-import",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport(moduleName).then(consume);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 45,
    name: "type-only-import-query-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\ntype NativeModule = typeof import("react-native");\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 46,
    name: "instance-unmount-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.componentWillUnmount = () => {}; this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 47,
    name: "instance-mount-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.componentDidMount = () => {}; this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 48,
    name: "instance-listener-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.handleChange = replacement; this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 49,
    name: "class-prototype-unmount-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\nExample.prototype.componentWillUnmount = () => {};\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 50,
    name: "class-alias-prototype-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\nconst Alias = Example; Alias.prototype.componentWillUnmount = () => {};\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 51,
    name: "class-prototype-destructure-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\nconst { prototype } = Example; prototype.componentWillUnmount = () => {};\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 52,
    name: "class-prototype-reflection-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\nObject.defineProperty(Example.prototype, "componentWillUnmount", { value: () => {} });\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 53,
    name: "unmount-unconditional-return-before-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { return; if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 54,
    name: "unmount-conditional-return-before-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.props.skip) return; if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 55,
    name: "unmount-throw-before-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { throw stop; if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 56,
    name: "ordinary-prior-remove-followed-by-presence-guard",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null; other = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.other) { this.other.remove(); this.other = null; } if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 57,
    name: "shadowed-provider-parameter",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount(DeviceEventEmitter) { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 58,
    name: "genuine-global-singleton-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nglobal.__rctDeviceEventEmitter.addListener = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 59,
    name: "genuine-global-singleton-alias-escape",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconst nativeCarrier = global.__rctDeviceEventEmitter; consume(nativeCarrier);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 60,
    name: "genuine-globalThis-singleton-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nglobalThis.__rctDeviceEventEmitter.addListener = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 61,
    name: "runtime-native-internal-provider-carrier",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport InternalEmitter from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter"; InternalEmitter.addListener = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 62,
    name: "shadowed-global-name-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconst global = { __rctDeviceEventEmitter: { addListener() {} } }; global.__rctDeviceEventEmitter.addListener = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 63,
    name: "type-only-native-internal-carrier-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport type InternalEmitter from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 64,
    name: "type-only-global-reference-preservation",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\ntype GlobalShape = typeof globalThis;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 65,
    name: "computed-lifecycle-override",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconst lifecycleName = "componentWillUnmount";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  [lifecycleName]() {}\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 66,
    name: "runtime-createRequire-native-carrier",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport { createRequire } from "node:module";\nconst runtimeRequire = createRequire(import.meta.url);\nconsume(runtimeRequire("react-native"));\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 67,
    name: "type-only-module-carrier-preserved",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport { type createRequire } from "node:module";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 68,
    name: "handler-array-pattern-write",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { [this.handleChange] = [() => {}]; this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 69,
    name: "handler-object-pattern-write",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { ({ handler: this.handleChange } = callbacks); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 70,
    name: "handler-loop-target-write",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { for (this.handleChange of callbacks) {} this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 71,
    name: "legacy-instance-accessor-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  constructor(...args) { super(...args); this.__defineGetter__("subscription", () => null); this.__defineSetter__("subscription", value => {}); }\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 72,
    name: "opaque-instance-call-with-visible-local-callback",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nconst mutateInstance = function() { this.subscription = null; };\nexport class Example extends React.Component {\n  subscription = null;\n  run = mutateInstance;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); this.run(); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 73,
    name: "unproven-component-superclass-and-no-own-field",
    code: 'class Component { set subscription(value) {} get subscription() { return null; } }\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends Component {\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 74,
    name: "native-component-without-own-null-field",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 75,
    name: "readonly-own-method-and-native-setState",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.refresh(); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  refresh() { this.setState({ active: true }); }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 76,
    name: "default-native-React-forceUpdate-and-type-carrier",
    code: 'import React from "react";\nimport type * as ReactTypes from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.forceUpdate(); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 77,
    name: "type-only-native-React-base",
    code: 'import type * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 78,
    name: "foreign-React-base",
    code: 'import * as React from "other-framework";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 79,
    name: "replaced-native-React-base",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nReact.Component = replacement;\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 80,
    name: "additional-native-React-carrier",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nimport OtherReact from "react";\nconsume(OtherReact);\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 81,
    name: "own-callable-pattern-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { [this.refresh] = [mutateInstance]; this.refresh(); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  refresh() {}\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 82,
    name: "direct-this-tagged-template-call",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.refresh`value`; this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  refresh() {}\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 83,
    name: "direct-this-called-accessor",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.refresh(); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  get refresh() { return mutateInstance; }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 84,
    name: "duplicate-own-called-method",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.refresh(); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  refresh() {}\n  refresh() {}\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 85,
    name: "decorated-own-called-method",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.refresh(); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  @decorate refresh() {}\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 86,
    name: "native-React-isValidElement-source-role",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return React.isValidElement(this.props.children) ? this.props.children : null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 87,
    name: "native-forceUpdate-opaque-completion",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.forceUpdate(function () { this.subscription = null; }); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 88,
    name: "native-setState-opaque-completion",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.setState({}, completion); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 89,
    name: "native-setState-updater-callback",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.setState(function () { this.subscription = null; return {}; }); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 90,
    name: "super-native-callback-transport",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { super.forceUpdate(completion); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 91,
    name: "own-updater-field-replacement",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  updater = customUpdater;\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 92,
    name: "instance-updater-projection",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { consume(this.updater); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 93,
    name: "constructor-third-updater-argument",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  constructor(props) { super(props, null, customUpdater); }\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 94,
    name: "constructor-spread-arguments",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  constructor(props) { super(...props); }\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 95,
    name: "constructor-alternate-instance-return",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  constructor(props) { super(props); return alternateInstance; }\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 96,
    name: "native-setState-inline-completion-preserved",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.setState({ ready: true }, () => { this.forceUpdate(); }); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
  {
    index: 97,
    name: "native-setState-inline-selected-field-write",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.setState({ ready: true }, () => { this.subscription = null; }); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 1,
  },
  {
    index: 98,
    name: "ordinary-native-constructor-and-inline-completion",
    code: 'import * as React from "react";\nimport { DeviceEventEmitter } from "react-native";\nexport class Example extends React.Component {\n  constructor(props) { super(props); }\n  subscription = null;\n  handleChange = () => {};\n  componentDidMount() { this.setState({}, () => {}); this.subscription = DeviceEventEmitter.addListener("change", this.handleChange); }\n  componentWillUnmount() { if (this.subscription) { this.subscription.remove(); } }\n  render() { return null; }\n}\n',
    options: {
      filename: "example.tsx",
    },
    expected: 0,
  },
];

describe("owned native emitter subscription cleanup", () => {
  for (const entry of cases) {
    it(entry.name, () => {
      const result = runRule(classComponentMissingComponentWillUnmountTeardown, entry.code, {
        ...entry.options,
        includeLocations: true,
        forceJsx: true,
        settings: { "react-doctor": { capabilities: ["react"], portedRuleMode: "curated" } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(entry.expected);
    });
  }
});
