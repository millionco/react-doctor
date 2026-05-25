// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { noBoldHeading } from "./../rules/react-ui/no-bold-heading.js";
import { noEmDashInJsxText } from "./../rules/react-ui/no-em-dash-in-jsx-text.js";
import { noRedundantPaddingAxes } from "./../rules/react-ui/no-redundant-padding-axes.js";
import { noRedundantSizeAxes } from "./../rules/react-ui/no-redundant-size-axes.js";
import { noSpaceOnFlexChildren } from "./../rules/react-ui/no-space-on-flex-children.js";
import { noThreePeriodEllipsis } from "./../rules/react-ui/no-three-period-ellipsis.js";
import { noVagueButtonLabel } from "./../rules/react-ui/no-vague-button-label.js";

export const ReactUiRuleEntries = [
  {
    key: "react-doctor/design-no-bold-heading",
    id: "design-no-bold-heading",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noBoldHeading,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-em-dash-in-jsx-text",
    id: "design-no-em-dash-in-jsx-text",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noEmDashInJsxText,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-redundant-padding-axes",
    id: "design-no-redundant-padding-axes",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRedundantPaddingAxes,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-redundant-size-axes",
    id: "design-no-redundant-size-axes",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRedundantSizeAxes,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-space-on-flex-children",
    id: "design-no-space-on-flex-children",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noSpaceOnFlexChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-three-period-ellipsis",
    id: "design-no-three-period-ellipsis",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noThreePeriodEllipsis,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/design-no-vague-button-label",
    id: "design-no-vague-button-label",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noVagueButtonLabel,
      framework: "global",
      category: "Accessibility",
    },
  },
] as const;
