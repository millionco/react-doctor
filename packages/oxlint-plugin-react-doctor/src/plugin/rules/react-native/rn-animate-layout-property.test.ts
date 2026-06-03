import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnAnimateLayoutProperty } from "./rn-animate-layout-property.js";

describe("rn-animate-layout-property", () => {
  it("flags layout properties driven directly by Reanimated animation helpers", () => {
    const code = `
      import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";

      const Panel = ({ isOpen }) => {
        const animatedLayoutStyle = useAnimatedStyle(() => ({
          height: withTiming(isOpen ? 240 : 0),
        }));

        return <Animated.View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"height"');
  });

  it("flags aliased Reanimated animation helpers", () => {
    const code = `
      import Animated, { useAnimatedStyle, withSpring as spring } from "react-native-reanimated";

      const Panel = ({ targetWidth }) => {
        const animatedLayoutStyle = useAnimatedStyle(() => ({
          width: spring(targetWidth),
        }));

        return <Animated.View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags namespace Reanimated animation helpers", () => {
    const code = `
      import * as Reanimated from "react-native-reanimated";

      const Panel = ({ targetWidth }) => {
        const animatedLayoutStyle = Reanimated.useAnimatedStyle(() => ({
          "width": Reanimated.withTiming(targetWidth),
        }));

        return <Reanimated.View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Reanimated interpolate-driven layout styles", () => {
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

  it("does not flag shared-value layout styles without an animation helper", () => {
    const code = `
      import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

      const Panel = () => {
        const height = useSharedValue(100);
        const animatedLayoutStyle = useAnimatedStyle(() => ({
          height: height.value,
        }));

        return <Animated.View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-layout styles driven by animation helpers", () => {
    const code = `
      import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";

      const Panel = ({ isOpen }) => {
        const animatedStyle = useAnimatedStyle(() => ({
          opacity: withTiming(isOpen ? 1 : 0),
          transform: [{ scale: withTiming(isOpen ? 1 : 0.95) }],
        }));

        return <Animated.View style={animatedStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag local functions with Reanimated-like names", () => {
    const code = `
      const useAnimatedStyle = (callback) => callback();
      const withTiming = (value) => value;

      const Panel = ({ targetHeight }) => {
        const animatedLayoutStyle = useAnimatedStyle(() => ({
          height: withTiming(targetHeight),
        }));

        return <View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag shadowed animation helper names", () => {
    const code = `
      import Animated, { useAnimatedStyle, withTiming as reanimatedTiming } from "react-native-reanimated";

      const Panel = ({ targetHeight }) => {
        const withTiming = (value) => value;
        const animatedLayoutStyle = useAnimatedStyle(() => ({
          height: withTiming(targetHeight),
          marginTop: reanimatedTiming(8),
        }));

        return <Animated.View style={animatedLayoutStyle} />;
      };
    `;

    const result = runRule(rnAnimateLayoutProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"marginTop"');
  });
});
