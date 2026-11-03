import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const stableDirectFieldCases = [
  [
    "exact direct matcher field",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "renamed direct matcher field",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly queries: MatcherRecord;\n  private readonly onViewportChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.queries = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.queries).forEach((matcher) => matcher.addListener(this.onViewportChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.queries).forEach((matcher) => matcher.removeListener(this.onViewportChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "stable mutable field and handler declarations",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private matchers: MatcherRecord;\n  private handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "renamed static record keys",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  narrowQuery: MediaQueryList;\n  largeQuery: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      narrowQuery: window.matchMedia("(max-width: 600px)"),\n      largeQuery: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "single-expression callback blocks",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => { matcher.addListener(this.handleChange); });\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => { matcher.removeListener(this.handleChange); });\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
];

describe("Supported stable direct fields", () => {
  it.each(stableDirectFieldCases)("%s", (_name, code) => {
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, code, {
      filename: "/src/responsive-panel.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

const leakingDirectFieldCases = [
  [
    "conditional release",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<{ release: boolean }> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: { release: boolean }) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    if (this.props.release) { Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange)); }\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "fresh record getter",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private get matchers(): MatcherRecord { return { compact: window.matchMedia("compact"), wide: window.matchMedia("wide") }; }\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "missing release",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    \n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "nested entry replacement",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  replaceMatcher() { this.matchers.compact = window.matchMedia("replacement"); }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "partial release",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    this.matchers.compact.removeListener(this.handleChange);\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "record escape",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nlet escapedRecord: MatcherRecord | undefined;\nexport const replaceEscaped = () => { if (escapedRecord) escapedRecord.compact = window.matchMedia("replacement"); };\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n    escapedRecord = this.matchers;\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "throw before release",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\ndeclare const mayThrow: () => void;\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    mayThrow(); Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "wrong handler",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly wrongHandler = () => {};\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.wrongHandler));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "whole record replacement",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  replaceRecord() { this.matchers = { compact: window.matchMedia("new compact"), wide: window.matchMedia("new wide") }; }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "handler replacement",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  replaceHandler() { this.handleChange = () => {}; }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "hidden handler replacement",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  replaceHandler() { try { throw {}; } catch ({ ignored = (this.handleChange = () => {}) }: any) {} }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "visible overridden unmount",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n\nclass ChildPanel extends ResponsivePanel { componentWillUnmount() {} }\n',
  ],
];

describe("Leaking or visibly overridden lifecycle controls", () => {
  it.each(leakingDirectFieldCases)("%s", (_name, code) => {
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, code, {
      filename: "/src/responsive-panel.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

const unsupportedDirectFieldCases = [
  [
    "opaque class consumer",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n\ndeclare const receiveClass: (value: typeof ResponsivePanel) => void;\nreceiveClass(ResponsivePanel);\n',
  ],
  [
    "opaque instance ref",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n\ndeclare const receiveInstance: (value: unknown) => void;\nconst view = <ResponsivePanel ref={receiveInstance} />;\n',
  ],
  [
    "native provider replacement",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nwindow.matchMedia = (query) => foreignMatcher(query);\ndeclare const foreignMatcher: (query: string) => MediaQueryList;\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "unproven nonempty handler",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => { console.log("change"); };\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "record spread",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    const extra = {};\n    this.matchers = { ...extra,\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "additional constructor operation",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  private readonly matchers: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    console.log("construct");\n    this.matchers = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.matchers).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
];

describe("Conservative unsupported precision boundaries", () => {
  it.each(unsupportedDirectFieldCases)("%s", (_name, code) => {
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, code, {
      filename: "/src/responsive-panel.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

const unsupportedReactManagedFieldCases = [
  [
    "unsupported React-managed props",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<MatcherRecord> {\n  readonly props: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: MatcherRecord) {\n    super(props);\n    this.props = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.props).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.props).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "unsupported React-managed state",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  readonly state: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.state = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.state).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.state).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "unsupported React-managed context",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  readonly context: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.context = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.context).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.context).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "unsupported React-managed refs",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  readonly refs: any;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.refs = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values<MediaQueryList>(this.refs).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values<MediaQueryList>(this.refs).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
  [
    "unsupported React-managed updater",
    '// rule: class-component-missing-component-will-unmount-teardown\n// weakness: control-flow\n// source: synthetic\nimport * as React from "react";\n\ninterface MatcherRecord {\n  compact: MediaQueryList;\n  wide: MediaQueryList;\n}\n\nexport class ResponsivePanel extends React.Component<Record<string, never>> {\n  readonly updater: MatcherRecord;\n  private readonly handleChange = () => {};\n\n  constructor(props: Record<string, never>) {\n    super(props);\n    this.updater = {\n      compact: window.matchMedia("(max-width: 600px)"),\n      wide: window.matchMedia("(min-width: 601px)"),\n    };\n  }\n\n  componentDidMount() {\n    Object.values(this.updater).forEach((matcher) => matcher.addListener(this.handleChange));\n  }\n\n  componentWillUnmount() {\n    Object.values(this.updater).forEach((matcher) => matcher.removeListener(this.handleChange));\n  }\n\n  render() {\n    return null;\n  }\n}\n',
  ],
];

describe("Unsupported React-managed fields", () => {
  it.each(unsupportedReactManagedFieldCases)("%s", (_name, code) => {
    const result = runRule(classComponentMissingComponentWillUnmountTeardown, code, {
      filename: "/src/responsive-panel.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
