import { describe, expect, it } from "vite-plus/test";
import {
  EDITABLE_POSITION_NOMINAL_SOURCE,
  EDITABLE_POSITION_WARNING_MESSAGE,
} from "../../../test-utils/editable-position-proof/constants.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface EditablePositionBindingCase {
  readonly name: string;
  readonly code: string;
  readonly expectedDiagnostics: ReadonlyArray<RuleDiagnostic>;
}

const cases: ReadonlyArray<EditablePositionBindingCase> = [
  {
    name: "nominal-author-zero",
    code: EDITABLE_POSITION_NOMINAL_SOURCE,
    expectedDiagnostics: [],
  },
  {
    name: "erased-hook-interface",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "export const PositionEditor",
      "interface useState {}\nexport const PositionEditor",
    ),
    expectedDiagnostics: [],
  },
  {
    name: "erased-nested-state-readonly",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      "  const focusNext = (position: number) => {\n    interface textValues {}\n",
    ),
    expectedDiagnostics: [],
  },
  {
    name: "nested-state-reverse",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      "  const focusNext = (position: number) => {\n    textValues.reverse();\n",
    ),
    expectedDiagnostics: [
      {
        column: 10,
        line: 36,
        message: EDITABLE_POSITION_WARNING_MESSAGE,
        nodeType: "JSXAttribute",
      },
    ],
  },
  {
    name: "erased-nested-state-reverse",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      "  const focusNext = (position: number) => {\n    interface textValues {}\n    textValues.reverse();\n",
    ),
    expectedDiagnostics: [
      {
        column: 10,
        line: 37,
        message: EDITABLE_POSITION_WARNING_MESSAGE,
        nodeType: "JSXAttribute",
      },
    ],
  },
  {
    name: "nested-nonempty-setter",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      '  const focusNext = (position: number) => {\n    setTextValues(["a", "b", "c"]);\n',
    ),
    expectedDiagnostics: [
      {
        column: 10,
        line: 36,
        message: EDITABLE_POSITION_WARNING_MESSAGE,
        nodeType: "JSXAttribute",
      },
    ],
  },
  {
    name: "erased-nested-nonempty-setter",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      '  const focusNext = (position: number) => {\n    interface setTextValues {}\n    setTextValues(["a", "b", "c"]);\n',
    ),
    expectedDiagnostics: [
      {
        column: 10,
        line: 37,
        message: EDITABLE_POSITION_WARNING_MESSAGE,
        nodeType: "JSXAttribute",
      },
    ],
  },
  {
    name: "erased-nested-setter-readonly",
    code: EDITABLE_POSITION_NOMINAL_SOURCE.replace(
      "  const focusNext = (position: number) => {\n",
      "  const focusNext = (position: number) => {\n    interface setTextValues {}\n",
    ),
    expectedDiagnostics: [],
  },
];

describe("no-array-index-as-key editable position runtime bindings", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noArrayIndexAsKey, testCase.code, {
        filename: "/src/editable-position-bindings.tsx",
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(testCase.expectedDiagnostics);
    });
  }
});
