import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnAnimateLayoutProperty } from "./rn-animate-layout-property.js";

describe("rn-animate-layout-property", () => {
  it("does not flag Reanimated keyboard-driven layout styles", () => {
    const code = `
      import { useKeyboardHandler } from "react-native-keyboard-controller";
      import Animated, { interpolate, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

      const LoginScreen = () => {
        const progress = useSharedValue(0);

        useKeyboardHandler(
          {
            onMove: (event) => {
              "worklet";
              progress.set(event.progress);
            },
          },
          [],
        );

        const headerOuterStyle = useAnimatedStyle(() => ({
          paddingBottom: interpolate(progress.value, [0, 1], [42, 16]),
        }));

        const iconContainerStyle = useAnimatedStyle(() => ({
          width: interpolate(progress.value, [0, 1], [70, 44]),
          height: interpolate(progress.value, [0, 1], [70, 44]),
          borderRadius: interpolate(progress.value, [0, 1], [24, 12]),
          marginBottom: interpolate(progress.value, [0, 1], [14, 0]),
          marginRight: interpolate(progress.value, [0, 1], [0, 12]),
        }));

        return <Animated.View style={[headerOuterStyle, iconContainerStyle]} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
