import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import type { Rule } from "../../utils/rule.js";
import { findUndisposedFlickityCreation } from "./utils/find-undisposed-flickity-creation.js";
import { runRuleOnParsedFixture, runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const cases = [
  {
    name: "probe-nominal",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-erased-constructor-interface",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    interface Flickity {}\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-erased-constructor-type",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    type Flickity = unknown;\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-erased-component-interface",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\ninterface Component {}\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-erased-options-interface",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    const { options = {} } = this.props;\n    interface options {}\n    this.widget = new Flickity(this.container, options);\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-erased-ref-statement",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { interface Marker {} this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-erased-ref-binding",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { interface element {} this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-runtime-constructor-shadow",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    const Flickity = class {};\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 0,
  },
  {
    name: "probe-global-Function-frontier",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nFunction(\"return 1\")();\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 0,
  },
  {
    name: "probe-erased-Function-frontier",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface Function {}\nFunction(\"return 1\")();\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 0,
  },
  {
    name: "probe-inert-jsx-string",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst inert = \"/** @jsx customFactory */\";\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-unused-custom-factory",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst customFactory = () => null;\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-custom-jsx-factory",
    code: "/** @jsx customFactory */\nimport React, { Component } from 'react';\nimport Flickity from 'flickity';\n\nconst customFactory = () => null;\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 0,
  },
  {
    name: "probe-native-jsx-classic",
    code: "/** @jsxRuntime classic */\nimport React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-native-jsx-React-factory",
    code: "/** @jsx React.createElement */\nimport React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-named-React-factory",
    code: "/** @jsx buildElement */\nimport React, { Component, createElement as buildElement } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 1,
  },
  {
    name: "probe-shadowed-React-factory",
    code: "/** @jsx React.createElement */\nimport React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { const React = { createElement: () => null }; return <div ref={element => { this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 0,
  },
  {
    name: "probe-runtime-ref-statement",
    code: "import React, { Component } from 'react';\nimport Flickity from 'flickity';\n\ninterface GalleryProps { options?: object; onAcquire?: (widget: unknown) => void; }\n\nclass Gallery extends Component<GalleryProps> {\n  container: HTMLDivElement | null = null;\n  widget: any = null;\n  componentDidMount() {\n    if (!this.container) return;\n    this.widget = new Flickity(this.container, {});\n  }\n\n  render() { return <div ref={element => { const marker = 1; this.container = element; }} />; }\n}\nexport default Gallery;\n",
    expected: 0,
  },
];

describe("Flickity runtime bindings and native ref delivery", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(classComponentMissingComponentWillUnmountTeardown, testCase.code, {
        filename: "flickity-boundary.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});

describe("Flickity current source identity", () => {
  for (const reverseOrder of [false, true]) {
    it(`rechecks source text across two analyses with reverse order ${reverseOrder}`, () => {
      const nominal = cases.find((testCase) => testCase.name === "probe-nominal")?.code;
      if (!nominal) throw new Error("Expected nominal fixture");
      const customSource = "/** @jsx customFactory */\n" + nominal;
      const sequence = reverseOrder
        ? [customSource, nominal, customSource, nominal]
        : [nominal, customSource, nominal, customSource];
      const parsed = parseFixture(nominal);
      const results: boolean[] = [];
      const probe: Rule = {
        id: "flickity-current-source-proof",
        severity: "warn",
        create: (context) => ({
          ClassBody: (node) => {
            for (const sourceText of sequence) {
              results.push(
                Boolean(
                  findUndisposedFlickityCreation(node, {
                    ...context,
                    sourceCode: { getText: () => sourceText },
                  }),
                ),
              );
            }
            results.push(
              Boolean(findUndisposedFlickityCreation(node, { ...context, sourceCode: undefined })),
            );
            results.push(
              Boolean(
                findUndisposedFlickityCreation(node, {
                  ...context,
                  sourceCode: {
                    getText: () => {
                      throw new Error("Unavailable source");
                    },
                  },
                }),
              ),
            );
          },
        }),
      };
      expect(runRuleOnParsedFixture(probe, nominal, parsed)).toEqual({
        diagnostics: [],
        parseErrors: [],
      });
      expect(runRuleOnParsedFixture(probe, nominal, parsed)).toEqual({
        diagnostics: [],
        parseErrors: [],
      });
      const expected = [...sequence.map((sourceText) => sourceText === nominal), false, false];
      expect(results).toEqual([...expected, ...expected]);
    });
  }
});
