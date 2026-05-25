// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { noArrayIndexAsKey } from "./../rules/correctness/no-array-index-as-key.js";
import { noPolymorphicChildren } from "./../rules/correctness/no-polymorphic-children.js";
import { noPreventDefault } from "./../rules/correctness/no-prevent-default.js";
import { noUncontrolledInput } from "./../rules/correctness/no-uncontrolled-input.js";
import { renderingConditionalRender } from "./../rules/correctness/rendering-conditional-render.js";
import { renderingSvgPrecision } from "./../rules/correctness/rendering-svg-precision.js";

export const CorrectnessRuleEntries = [
  {
    key: "react-doctor/no-array-index-as-key",
    id: "no-array-index-as-key",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noArrayIndexAsKey,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-polymorphic-children",
    id: "no-polymorphic-children",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noPolymorphicChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-prevent-default",
    id: "no-prevent-default",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noPreventDefault,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-uncontrolled-input",
    id: "no-uncontrolled-input",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUncontrolledInput,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rendering-conditional-render",
    id: "rendering-conditional-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...renderingConditionalRender,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rendering-svg-precision",
    id: "rendering-svg-precision",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...renderingSvgPrecision,
      framework: "global",
      category: "Performance",
    },
  },
] as const;
