import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnAnimateLayoutProperty } from "./rn-animate-layout-property.js";

describe("rn-animate-layout-property", () => {
  it("does not flag legacy Reanimated layout-style false positives", () => {
    const code = `
      import Animated, { interpolate, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

      const LoginScreen = () => {
        const progress = useSharedValue(0);

        const animatedLayoutStyle = useAnimatedStyle(() => ({
          paddingBottom: interpolate(progress.value, [0, 1], [42, 16]),
          width: interpolate(progress.value, [0, 1], [70, 44]),
          height: interpolate(progress.value, [0, 1], [70, 44]),
        }));

        return <Animated.View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
