import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { rnPreferPressable } from "./rn-prefer-pressable.js";

interface PressableGuidanceCase {
  name: string;
  code: string;
  expectedMessages: string[];
}

const commonOptions: RunRuleOptions = { filename: "fixture.tsx" };

const guidanceCases: PressableGuidanceCase[] = [
  {
    name: "unused-native-value-import",
    code: 'import { TouchableOpacity } from "react-native";',
    expectedMessages: [
      "This value import of TouchableOpacity is a candidate for Pressable migration. Confirm that interaction and accessibility behavior can be preserved.",
    ],
  },
  {
    name: "aliased-native-value-import",
    code: 'import { TouchableHighlight as HighlightButton } from "react-native";',
    expectedMessages: [
      "This value import of TouchableHighlight is a candidate for Pressable migration. Confirm that interaction and accessibility behavior can be preserved.",
    ],
  },
  {
    name: "gesture-handler-value-import",
    code: 'import { TouchableWithoutFeedback as GestureTouchable } from "react-native-gesture-handler";',
    expectedMessages: [
      "This value import of TouchableWithoutFeedback is a candidate for Pressable migration. Confirm that interaction and accessibility behavior can be preserved.",
    ],
  },
  {
    name: "mixed-value-and-type-import",
    code: 'import { type TouchableOpacity, TouchableNativeFeedback as NativeButton } from "react-native";',
    expectedMessages: [
      "This value import of TouchableNativeFeedback is a candidate for Pressable migration. Confirm that interaction and accessibility behavior can be preserved.",
    ],
  },
  {
    name: "declaration-type-only-import",
    code: 'import type { TouchableOpacity } from "react-native";',
    expectedMessages: [],
  },
  {
    name: "specifier-type-only-import",
    code: 'import { type TouchableHighlight } from "react-native";',
    expectedMessages: [],
  },
  {
    name: "foreign-provider-import",
    code: 'import { TouchableOpacity } from "other-native-controls";',
    expectedMessages: [],
  },
  {
    name: "namespace-default-and-pressable-imports",
    code: 'import Native from "react-native"; import * as NativeControls from "react-native"; import { Pressable } from "react-native";',
    expectedMessages: [],
  },
];

describe("react-native/rn-prefer-pressable import guidance", () => {
  it.each(guidanceCases)("$name", ({ code, expectedMessages }) => {
    const result = runRule(rnPreferPressable, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expectedMessages);
  });

  it("keeps migration advice conditional on preserving behavior", () => {
    expect(rnPreferPressable.recommendation).toBe(
      "Consider `Pressable` only when press feedback, callbacks, gestures, accessibility, and layout can be preserved; otherwise keep the existing Touchable.",
    );
  });
});
