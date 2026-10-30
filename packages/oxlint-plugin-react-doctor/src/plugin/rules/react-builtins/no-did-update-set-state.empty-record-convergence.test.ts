import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidUpdateSetState } from "./no-did-update-set-state.js";

const cases = [
  {
    name: "canonical empty-record state reset",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "conjunctive hidden-state empty-record reset",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (this.state.hidden && !compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "reverse comparator arguments and actual import alias",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(this.state.record, previousState.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "opaque fresh payload must remain unsupported",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: computeRecord() }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "local fake equality comparator always false",
    code: "import React from 'react';\nconst compare = () => false;\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "different compared and written field",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ other: this.state.other + 1 }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "OR permits write without comparator difference",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (this.state.hidden || !compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 78,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "competing own lifecycle producer invalidates convergence",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\nthis.setState({ record: computeRecord() });\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
      {
        column: 0,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "literal custom prototype is not an empty plain record",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: { __proto__: customPrototype } }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "static derived-state producer invalidates empty-record convergence",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n static getDerivedStateFromProps(properties, state) { return { record: { value: state.other + 1 }, other: state.other + 1 }; }\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "snapshot mutates selected state before each update",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n getSnapshotBeforeUpdate() { this.state.record = { value: ++this.state.other }; return null; }\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "direct selected-field mutation in an own method is unsupported",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n regenerate() { this.state.record = { enabled: false }; }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "module attaches a derived-state producer after class declaration",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\nlet version = 0;\nPanel.getDerivedStateFromProps = () => ({ record: { version: version++ } });\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "constructor overrides actual render through an own method",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n constructor(properties) { super(properties); this.render = this.regenerate.bind(this); }\n regenerate() { this.state.record = { enabled: false }; return null; }\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 8,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "selected state-record alias escapes to an opaque function",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n expose() { consume(this.state.record); }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "class binding escapes to a local mutation installer",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\ninstall(Panel);\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "unconditional other-field update keeps producing native updates",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n this.setState({ other: this.state.other + 1 });\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
      {
        column: 1,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "constructor schedules another source-visible state producer",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n constructor(properties) { super(properties); this.state = { record: {}, other: 0 }; setInterval(() => this.setState({ record: { value: 1 } }), 1); }\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "selected-field reset cannot certify its own render barrier",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!this.state.record && !compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { if (!this.state.record) return null; return <Child />; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 79,
        line: 6,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "props-transition other-field updates with hidden native-render barrier",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.PureComponent {\n constructor(properties) { super(properties); this.state = { render: properties.visible, visible: properties.visible, record: {} }; }\n componentDidUpdate(previousProps, previousState) {\n  if (previousProps.visible && !this.props.visible) this.setState({ visible: false, record: {} });\n  else if (!previousProps.visible && this.props.visible) this.setState({ render: true, visible: true });\n  if (!this.state.render && !compare(previousState.record, this.state.record)) this.setState({ record: {} });\n }\n updateRecord = (value) => this.setState(state => ({ record: typeof value === 'function' ? value(state.record) : value }));\n get projection() { return { ...this.state.record }; }\n render() { if (!this.state.render) return null; return <Child projection={this.projection} update={this.updateRecord} />; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "module-attached-derived-state-regenerates-record",
    code: "import React from 'react';\nimport equal from 'react-fast-compare';\nlet version = 0;\nexport class Example extends React.Component {\n  state = { record: { version: 0 } };\n  componentDidUpdate(previousProps, previousState) {\n    if (!equal(previousState.record, this.state.record)) {\n      this.setState({ record: {} });\n    }\n  }\n  render() { return null; }\n}\nExample.getDerivedStateFromProps = () => ({ record: { version: version++ } });\n",
    options: {
      filename: "synthetic-empty-record-runtime-role-closure.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 6,
        line: 8,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "constructor-overrides-null-render-with-mutating-own-renderer",
    code: "import React from 'react';\nimport equal from 'react-fast-compare';\nlet version = 0;\nexport class Example extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { record: { version: 0 }, ready: false };\n    this.render = this.regenerate.bind(this);\n  }\n  componentDidMount() { this.setState({ ready: true }); }\n  regenerate() {\n    this.state.record = { version: ++version };\n    return null;\n  }\n  componentDidUpdate(previousProps, previousState) {\n    if (!equal(previousState.record, this.state.record)) {\n      this.setState({ record: {} });\n    }\n  }\n  render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-runtime-role-closure.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 6,
        line: 17,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "eager class field schedules a repeated state-record producer",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n timer = setInterval(() => this.setState({ record: { enabled: true } }), 1);\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "ordinary wrapper component display-name template is metadata only",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport const wrap = (Component) => { return class extends React.PureComponent {\n static displayName = `Wrapped(${Component.displayName})`;\n state = { hidden: true, record: { enabled: true } };\n componentDidUpdate(previousProps, previousState) {\n  if (!compare(previousState.record, this.state.record)) this.setState({ record: {} });\n }\n render() { return null; }\n}; };\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "display-name initializer cannot invoke a stateful callback",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport const wrap = (Component) => { return class extends React.PureComponent {\n static displayName = install(Component);\n state = { hidden: true, record: { enabled: true } };\n componentDidUpdate(previousProps, previousState) {\n  if (!compare(previousState.record, this.state.record)) this.setState({ record: {} });\n }\n render() { return null; }\n}; };\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "wrapper component metadata writes invalidate read-only metadata proof",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport const wrap = (Component) => { Component.displayName = { toString() { return 'changed'; } }; return class extends React.PureComponent {\n static displayName = `Wrapped(${Component.displayName})`;\n state = { hidden: true, record: { enabled: true } };\n componentDidUpdate(previousProps, previousState) {\n  if (!compare(previousState.record, this.state.record)) this.setState({ record: {} });\n }\n render() { return null; }\n}; };\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "literal-constructor-does-not-cancel-eager-state-field-timer",
    code: "import React from 'react';\nimport equal from 'react-fast-compare';\nlet version = 0;\nexport class Example extends React.Component {\n  state = { timer: setInterval(() => this.setState({ record: { version: ++version } }), 1), record: {} };\n  constructor(props) {\n    super(props);\n    this.state = { record: {} };\n  }\n  componentDidUpdate(previousProps, previousState) {\n    if (!equal(previousState.record, this.state.record)) this.setState({ record: {} });\n  }\n  render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-dual-initializer.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 11,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "tagged state initializer eagerly invokes a deferred class producer",
    code: "import React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n schedule = () => setInterval(() => this.setState({ record: { enabled: true } }), 1);\n state = { record: this.schedule`` };\n componentDidUpdate(previousProps, previousState) {\n  if (!compare(previousState.record, this.state.record)) this.setState({ record: {} });\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-comparator-reset.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "state-initializer-property-read-invokes-source-visible-own-getter",
    code: "import React from 'react';\nimport equal from 'react-fast-compare';\nlet version = 0;\nexport class Example extends React.Component {\n  state = { record: this.seed };\n  get seed() {\n    setInterval(() => this.setState({ record: { version: ++version } }), 1);\n    return {};\n  }\n  componentDidUpdate(previousProps, previousState) {\n    if (!equal(previousState.record, this.state.record)) this.setState({ record: {} });\n  }\n  render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-eager-getter.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 11,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
  {
    name: "erased-nested-provider-name",
    code: "type Note = { nested: { Function: string } };\nimport React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-boundary.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "erased-nested-interface",
    code: "interface Note { nested: { Object: string } };\nimport React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-boundary.tsx",
      includeLocations: true,
    },
    expected: [],
  },
  {
    name: "unsupported-runtime-parameter-property",
    code: "class Setup { constructor(public value = 1) {} };\nimport React from 'react';\nimport compare from 'react-fast-compare';\nexport class Panel extends React.Component {\n state = { hidden: true, record: { enabled: true }, other: 0 };\n componentDidUpdate(previousProps, previousState) {\nif (!compare(previousState.record, this.state.record)) { this.setState({ record: {} }); }\n }\n render() { return null; }\n}\n",
    options: {
      filename: "synthetic-empty-record-boundary.tsx",
      includeLocations: true,
    },
    expected: [
      {
        column: 57,
        line: 7,
        message:
          "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.",
        nodeType: "MemberExpression",
      },
    ],
  },
];

describe("empty-record comparator convergence", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noDidUpdateSetState, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(testCase.expected);
    });
  }
});
