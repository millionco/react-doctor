import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

interface MatcherPrecisionRegressionCase {
  readonly name: string;
  readonly code: string;
  readonly filename: string;
  readonly expectedDiagnosticCount: number;
  readonly conservativeWarning: boolean;
}

const CLOSED_MATCHER_SOURCE =
  'import React from "react";\n\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n';

const MISSING_UNMOUNT_SOURCE =
  'import React from "react";\n\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n\n  render() {\n    return null;\n  }\n}\n';

const RECORD_MATCHER_SOURCE =
  'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    \n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n';

const precisionCases: MatcherPrecisionRegressionCase[] = [
  {
    name: "nominal",
    code: CLOSED_MATCHER_SOURCE + "\n",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "named-export",
    code: CLOSED_MATCHER_SOURCE + "\nexport { MatcherComponent };",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "default-export",
    code: CLOSED_MATCHER_SOURCE + "\nexport default MatcherComponent;",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "direct-jsx",
    code: CLOSED_MATCHER_SOURCE + "\nconst element=<MatcherComponent/>;",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "const-alias-jsx",
    code: CLOSED_MATCHER_SOURCE + "\nconst Alias=MatcherComponent;const element=<Alias/>;",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "transitive-const-alias-jsx",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst First=MatcherComponent;const Second=First;const element=<Second/>;",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "named-alias-export",
    code: CLOSED_MATCHER_SOURCE + "\nconst Alias=MatcherComponent;export {Alias};",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "react-create-element",
    code: CLOSED_MATCHER_SOURCE + "\nconst element=React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "react-memo",
    code: CLOSED_MATCHER_SOURCE + "\nconst Memo=React.memo(MatcherComponent);",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "discarded-new-instance",
    code: CLOSED_MATCHER_SOURCE + '\nnew MatcherComponent({queries:{wide:"(width > 1px)"}});',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unused-local-new-instance",
    code:
      CLOSED_MATCHER_SOURCE +
      '\nconst instance=new MatcherComponent({queries:{wide:"(width > 1px)"}});',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "void-local-new-instance",
    code:
      CLOSED_MATCHER_SOURCE +
      '\nconst instance=new MatcherComponent({queries:{wide:"(width > 1px)"}});void instance;',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-class",
    code:
      CLOSED_MATCHER_SOURCE + "\nclass Other extends React.Component { componentWillUnmount() {} }",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "shadowed-class-binding",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst unrelated=()=>{class MatcherComponent{};class Child extends MatcherComponent{componentWillUnmount(){}};return Child;};",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-types",
    code:
      CLOSED_MATCHER_SOURCE +
      "\ninterface Metadata { label:string; } type Index=Record<string,Metadata>;",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "class-type-query",
    code: CLOSED_MATCHER_SOURCE + "\ntype Constructor=typeof MatcherComponent;",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "direct-derived-noop-unmount",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nclass Child extends MatcherComponent {\n  componentWillUnmount() {}\n}\n",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "const-alias-derived-noop-unmount",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst Alias=MatcherComponent;class Child extends Alias{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "transitive-alias-derived-noop-unmount",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst First=MatcherComponent;const Second=First;class Child extends Second{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "derived-unmount-undefined",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nclass Child extends MatcherComponent{componentWillUnmount=undefined;}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "benign-derived-unsupported",
    code: CLOSED_MATCHER_SOURCE + "\nclass Child extends MatcherComponent{}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "empty-mount-derived-unsupported",
    code: CLOSED_MATCHER_SOURCE + "\nclass Child extends MatcherComponent{componentDidMount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "both-empty-derived-unsupported",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nclass Child extends MatcherComponent{componentDidMount(){}componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "mutable-class-alias-unsupported",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nlet Alias=MatcherComponent;class Child extends Alias{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "class-container-escape",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst box={Base:MatcherComponent};class Child extends box.Base{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "unknown-class-consumer",
    code: CLOSED_MATCHER_SOURCE + "\npublish(MatcherComponent);",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "hidden-class-escape",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nlet Escaped;try{throw{}}catch({ignored=(Escaped=MatcherComponent)}){}class Child extends Escaped{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "instance-unmount-overwrite",
    code:
      CLOSED_MATCHER_SOURCE +
      '\nconst instance=new MatcherComponent({queries:{wide:"(width > 1px)"}});instance.componentWillUnmount=()=>{};',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "instance-state-replacement",
    code:
      CLOSED_MATCHER_SOURCE +
      '\nconst instance=new MatcherComponent({queries:{wide:"(width > 1px)"}});instance.state={matchers:{}};',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "unknown-instance-escape",
    code:
      CLOSED_MATCHER_SOURCE +
      '\nconst instance=new MatcherComponent({queries:{wide:"(width > 1px)"}});publish(instance);',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "anonymous-default-export",
    code: 'import React from "react";\n\nexport default class extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "missing-unmount-positive",
    code: MISSING_UNMOUNT_SOURCE,
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "record-nominal",
    code: RECORD_MATCHER_SOURCE,
    filename: "/virtual/src/media-panel.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "record-safe-default",
    code: 'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    try { throw {}; } catch ({ ignored = 0 }) {}\n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n',
    filename: "/virtual/src/media-panel.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "record-ordinary-escape",
    code: 'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    escapedRecord = matchers;\n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n',
    filename: "/virtual/src/media-panel.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "record-catch-default-escape",
    code: 'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    try { throw {}; } catch ({ ignored = (escapedRecord = matchers) }) {}\n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n',
    filename: "/virtual/src/media-panel.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "record-missing-release",
    code: 'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    \n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => void matcher);\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n',
    filename: "/virtual/src/media-panel.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "react-namespace-alias-safe",
    code:
      CLOSED_MATCHER_SOURCE + "\nconst R=React;const element=R.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "react-direct-api-replaced",
    code:
      'import {foreign} from "./consumer";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nReact.createElement=foreign;const element=React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "react-alias-api-replaced",
    code:
      'import {foreign} from "./consumer";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst R=React;R.createElement=foreign;const element=R.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "react-alias-catch-api-replaced",
    code:
      'import {foreign} from "./consumer";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst R=React;try{throw{}}catch({ignored=(R.createElement=foreign)}){}const element=R.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "react-alias-harmless-default",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst R=React;function touch(value=0){var R;}touch();const element=R.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "react-alias-body-shadow-default",
    code:
      'import {foreign} from "./consumer";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst R=React;function touch(value=(R.createElement=foreign)){var R;}touch();const element=R.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "class-body-shadow-default",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nlet Escaped;function expose(value=(Escaped=MatcherComponent)){var MatcherComponent;}expose();class Child extends Escaped{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "class-harmless-body-default",
    code: CLOSED_MATCHER_SOURCE + "\nfunction expose(value=0){var MatcherComponent;}expose();",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "jsx-opaque-ref",
    code:
      'import {receive} from "./receiver";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst element=<MatcherComponent ref={receive}/>;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "jsx-null-ref",
    code: CLOSED_MATCHER_SOURCE + "\nconst element=<MatcherComponent ref={null}/>;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "create-element-opaque-ref",
    code:
      'import {receive} from "./receiver";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst element=React.createElement(MatcherComponent,{ref:receive});",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "create-element-null-ref",
    code:
      CLOSED_MATCHER_SOURCE + "\nconst element=React.createElement(MatcherComponent,{ref:null});",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "jsx-unknown-props-spread",
    code:
      "declare const props:unknown;\n" +
      CLOSED_MATCHER_SOURCE +
      "\nconst element=<MatcherComponent {...props}/>;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "create-element-unknown-props",
    code:
      "declare const props:unknown;\n" +
      CLOSED_MATCHER_SOURCE +
      "\nconst element=React.createElement(MatcherComponent,props);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "memo-wrapper-no-ref",
    code: CLOSED_MATCHER_SOURCE + "\nconst W=React.memo(MatcherComponent);const element=<W/>;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "memo-wrapper-opaque-ref",
    code:
      'import {receive} from "./receiver";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst W=React.memo(MatcherComponent);const element=<W ref={receive}/>;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "nested-memo-opaque-ref",
    code:
      'import {receive} from "./receiver";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst element=React.createElement(React.memo(React.memo(MatcherComponent)),{ref:receive});",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "memo-wrapper-unknown-consumer",
    code: CLOSED_MATCHER_SOURCE + "\nconst W=React.memo(MatcherComponent);consume(W);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "create-element-type-escape",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst element=React.createElement(MatcherComponent);const Alias=element.type;class Child extends Alias{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "create-element-unknown-consumer",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst element=React.createElement(MatcherComponent);consume(element);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "named-create-element",
    code:
      'import {createElement as makeElement} from "react";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst element=makeElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "extracted-create-element-unsupported",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst makeElement=React.createElement;const element=makeElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "reassigned-extracted-api",
    code:
      'import {foreign} from "./consumer";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nlet makeElement=React.createElement;makeElement=foreign;const element=makeElement(MatcherComponent);",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "ambient-destructured-type",
    code:
      CLOSED_MATCHER_SOURCE +
      "\ndeclare function unrelatedSignature({MatcherComponent}:{MatcherComponent:unknown}):void;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "ambient-type-missing-release-positive",
    code:
      MISSING_UNMOUNT_SOURCE +
      "\ndeclare function unrelatedSignature({MatcherComponent}:{MatcherComponent:unknown}):void;",
    filename: "/virtual/src/matcher-consumer.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "record-body-shadow-default",
    code: 'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    \n    function expose(value=(escapedRecord=matchers)){var matchers;}expose();\n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n',
    filename: "/virtual/src/matcher-record.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "record-harmless-body-default",
    code: 'import React from "react";\nlet escapedRecord;\nexport class SyntheticMatcher extends React.Component {\n  constructor(props) {\n    super(props);\n    let matchers = undefined;\n    if (this.hasNativeMatchers()) {\n      matchers = this.createMatchers(props.queries);\n    }\n    \n    function expose(value=0){var matchers;}expose();\n    this.state = { matchers, ready: false };\n  }\n  hasNativeMatchers = () => typeof window !== "undefined" && typeof window.matchMedia !== "undefined";\n  createMatchers = (queries) => Object.keys(queries).reduce((record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }), {});\n  onChange = () => { this.setState({ ready: true }); };\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n  render() { return null; }\n}\nexport const replaceEscapedMatcher = () => {\n  if (escapedRecord) escapedRecord.narrow = window.matchMedia("(min-width: 9000px)");\n};\n',
    filename: "/virtual/src/matcher-record.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "jsx-direct-opaque-result",
    code: CLOSED_MATCHER_SOURCE + "\nconsumeElement(<MatcherComponent/>);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "jsx-aliased-opaque-result",
    code: CLOSED_MATCHER_SOURCE + "\nconst element=<MatcherComponent/>;consumeElement(element);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "jsx-result-type-escape",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst element=<MatcherComponent/>;const Alias=element.type;class Child extends Alias{componentWillUnmount(){}}",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "jsx-function-return-unsupported",
    code: CLOSED_MATCHER_SOURCE + "\nconst App=()=> <MatcherComponent/>;",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "create-element-return-unsupported",
    code: CLOSED_MATCHER_SOURCE + "\nconst App=()=>React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "jsx-direct-export",
    code: CLOSED_MATCHER_SOURCE + "\nexport default <MatcherComponent/>;",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "element-direct-export",
    code: CLOSED_MATCHER_SOURCE + "\nexport default React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-create-ref-element",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst ref=React.createRef();const element=React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-use-state-element",
    code:
      CLOSED_MATCHER_SOURCE +
      "\nconst other=()=>React.useState(0);const element=React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-named-create-ref",
    code:
      'import {createRef} from "react";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst ref=createRef();const element=React.createElement(MatcherComponent);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-create-ref-named-element",
    code:
      'import {createElement as makeElement} from "react";\n' +
      CLOSED_MATCHER_SOURCE +
      "\nconst ref=React.createRef();const element=makeElement(MatcherComponent);",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "unrelated-create-ref-jsx",
    code:
      CLOSED_MATCHER_SOURCE + "\nconst ref=React.createRef();const element=<MatcherComponent/>;",
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
  {
    name: "aliased-superclass-provider-replaced",
    code: 'import {foreign} from "./consumer";\nimport React from "react";\n\nconst R=React;R.Component=foreign;\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-result.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "opaque-direct-react-namespace",
    code: 'import {foreign} from "./consumer";\nimport React from "react";\n\nforeign(React);\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "opaque-aliased-react-namespace",
    code: 'import {foreign} from "./consumer";\nimport React from "react";\n\nconst R=React;foreign(R);\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-component.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "named-component-direct-escape",
    code: 'import React,{Component} from "react";\nimport {foreign} from "./consumer";\n\nforeign(Component);\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-named-provider.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "named-component-alias-escape",
    code: 'import React,{Component} from "react";\nimport {foreign} from "./consumer";\n\nconst Parent=Component;foreign(Parent);\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-named-provider.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "named-pure-component-escape",
    code: 'import React,{PureComponent} from "react";\nimport {foreign} from "./consumer";\n\nforeign(PureComponent);\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-named-provider.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: false,
  },
  {
    name: "named-base-escape-unsupported",
    code: 'import React,{Component} from "react";\nimport {foreign} from "./consumer";\n\nforeign(Component);\nclass MatcherComponent extends Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-named-provider.tsx",
    expectedDiagnosticCount: 1,
    conservativeWarning: true,
  },
  {
    name: "named-component-unused-safe",
    code: 'import React,{Component} from "react";\nimport {foreign} from "./consumer";\n\n\nclass MatcherComponent extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { matchers: this.createMatchers(props.queries) };\n  }\n\n  createMatchers = (queries) =>\n    Object.keys(queries).reduce(\n      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),\n      {},\n    );\n\n  onChange = () => {\n    this.setState({ changed: true });\n  };\n\n  componentDidMount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));\n    }\n  }\n\n  componentWillUnmount() {\n    if (this.state.matchers) {\n      const { onChange } = this;\n      Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));\n    }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
    filename: "/virtual/src/matcher-named-provider.tsx",
    expectedDiagnosticCount: 0,
    conservativeWarning: false,
  },
];

const precisionSuites = [
  {
    name: "closed class matcher reference and consumer precision",
    cases: precisionCases.filter((regressionCase) => !regressionCase.conservativeWarning),
  },
  {
    name: "conservative unsupported warning boundaries",
    cases: precisionCases.filter((regressionCase) => regressionCase.conservativeWarning),
  },
];

for (const precisionSuite of precisionSuites) {
  describe(precisionSuite.name, () => {
    it.each(precisionSuite.cases)("$name", (regressionCase) => {
      const result = runRule(
        classComponentMissingComponentWillUnmountTeardown,
        regressionCase.code,
        { filename: regressionCase.filename, includeLocations: true },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(regressionCase.expectedDiagnosticCount);
    });
  });
}
