import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noLegacyClassLifecycles } from "./no-legacy-class-lifecycles.js";

interface LifecycleGuidanceCase {
  name: string;
  code: string;
  expectedMessages: string[];
}

const commonOptions: RunRuleOptions = { filename: "fixture.tsx" };

const guidanceCases: LifecycleGuidanceCase[] = [
  {
    name: "legacy-componentWillMount",
    code: 'import { Component } from "react";\nclass Example extends Component { componentWillMount() {} render() { return null; } }',
    expectedMessages: [
      "`componentWillMount` is a legacy pre-commit lifecycle with concurrent-rendering risks. Review its work before choosing a migration. Put side effects in `componentDidMount` & initial state in the `constructor`.",
    ],
  },
  {
    name: "legacy-componentWillReceiveProps",
    code: 'import { Component } from "react";\nclass Example extends Component { componentWillReceiveProps() {} render() { return null; } }',
    expectedMessages: [
      "`componentWillReceiveProps` is a legacy pre-commit lifecycle with concurrent-rendering risks. Review its work before choosing a migration. Put side effects in `componentDidUpdate` & derived state in the static `getDerivedStateFromProps`.",
    ],
  },
  {
    name: "legacy-componentWillUpdate",
    code: 'import { Component } from "react";\nclass Example extends Component { componentWillUpdate = () => {}; render() { return null; } }',
    expectedMessages: [
      "`componentWillUpdate` is a legacy pre-commit lifecycle with concurrent-rendering risks. Review its work before choosing a migration. Read the DOM in `getSnapshotBeforeUpdate` & do other work in `componentDidUpdate`.",
    ],
  },
  {
    name: "prefixed-componentWillMount",
    code: 'import { Component } from "react";\nclass Example extends Component { UNSAFE_componentWillMount = () => {}; render() { return null; } }',
    expectedMessages: [
      "`UNSAFE_componentWillMount` is a historical lifecycle with concurrent-rendering risks; the UNSAFE_ prefix does not make its work concurrent-safe. Put side effects in `componentDidMount` & initial state in the `constructor`.",
    ],
  },
  {
    name: "prefixed-componentWillReceiveProps",
    code: 'import { Component } from "react";\nclass Example extends Component { UNSAFE_componentWillReceiveProps() {} render() { return null; } }',
    expectedMessages: [
      "`UNSAFE_componentWillReceiveProps` is a historical lifecycle with concurrent-rendering risks; the UNSAFE_ prefix does not make its work concurrent-safe. Put side effects in `componentDidUpdate` & derived state in the static `getDerivedStateFromProps`.",
    ],
  },
  {
    name: "prefixed-componentWillUpdate",
    code: 'import { Component } from "react";\nclass Example extends Component { UNSAFE_componentWillUpdate() {} render() { return null; } }',
    expectedMessages: [
      "`UNSAFE_componentWillUpdate` is a historical lifecycle with concurrent-rendering risks; the UNSAFE_ prefix does not make its work concurrent-safe. Read the DOM in `getSnapshotBeforeUpdate` & do other work in `componentDidUpdate`.",
    ],
  },
  {
    name: "superclass-less-class-stays-quiet",
    code: "class Ordinary { componentWillMount() {} UNSAFE_componentWillReceiveProps() {} }",
    expectedMessages: [],
  },
  {
    name: "static-computed-and-constructor-stay-quiet",
    code: 'import { Component } from "react"; const componentWillUpdate = "after"; class Example extends Component { constructor() { super(); } static componentWillMount() {} [componentWillUpdate]() {} render() { return null; } }',
    expectedMessages: [],
  },
];

describe("architecture/no-legacy-class-lifecycles migration guidance", () => {
  it.each(guidanceCases)("$name", ({ code, expectedMessages }) => {
    const result = runRule(noLegacyClassLifecycles, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expectedMessages);
  });

  it("recommends migration by intent without asserting API removal", () => {
    expect(noLegacyClassLifecycles.recommendation).toBe(
      "Choose a replacement for the lifecycle's intent: constructor or class fields for pure initial setup, `componentDidMount` for mount side effects, render-time derivation or guarded `componentDidUpdate` for prop-driven work, and `getSnapshotBeforeUpdate` for pre-update DOM reads. The documented `UNSAFE_` aliases do not make pre-commit work concurrent-safe.",
    );
  });
});
