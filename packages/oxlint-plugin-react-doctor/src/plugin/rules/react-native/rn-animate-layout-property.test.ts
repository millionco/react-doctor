import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnAnimateLayoutProperty } from "./rn-animate-layout-property.js";

describe("rn-animate-layout-property", () => {
  it("is retired and never reports diagnostics", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });
});
