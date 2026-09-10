import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferReanimated } from "./rn-prefer-reanimated.js";

describe("react-native/rn-prefer-reanimated — regressions", () => {
  it("stays silent on a type-only declaration import", () => {
    const result = runRule(rnPreferReanimated, `import type { Animated } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(rnPreferReanimated, `import { type Animated } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import of Animated", () => {
    const result = runRule(rnPreferReanimated, `import { Animated } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the only animation loops a native-driver timing", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { useEffect, useState } from "react";
import { Animated } from "react-native";

export function NativePulse() {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(opacity, {
        toValue: 0.7,
        duration: 2000,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View style={{ opacity }} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the native-driver config comes from a const object", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated } from "react-native";
const FADE_CONFIG = { toValue: 1, duration: 300, useNativeDriver: true };
export const fadeIn = (value) => Animated.timing(value, FADE_CONFIG).start();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an aliased Animated import only runs native-driver springs and events", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated as RNAnimated } from "react-native";
export const useScroll = (scrollY, scale) => ({
  onScroll: RNAnimated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
  press: () => RNAnimated.spring(scale, { toValue: 0.9, useNativeDriver: true }).start(),
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a timing with useNativeDriver: false", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated } from "react-native";
export const grow = (height) => Animated.timing(height, { toValue: 200, useNativeDriver: false }).start();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a timing that omits useNativeDriver", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated } from "react-native";
export const grow = (height) => Animated.timing(height, { toValue: 200, duration: 300 }).start();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let one native-driver call exempt a JS-thread animation in the same file", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated } from "react-native";
export const pulse = (opacity, height) => {
  Animated.timing(opacity, { toValue: 0.5, useNativeDriver: true }).start();
  Animated.timing(height, { toValue: 120, useNativeDriver: false }).start();
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a native-driver animation when a LayoutAnimation import sits alongside it", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated, LayoutAnimation } from "react-native";
export const fade = (opacity) => Animated.timing(opacity, { toValue: 0, useNativeDriver: true }).start();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("LayoutAnimation");
  });

  it("ignores timing calls on an Animated that is not the react-native export", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { Animated } from "react-native";
import Reanimated from "react-native-reanimated";
export const spin = (value) => Reanimated.timing(value, { toValue: 1, useNativeDriver: true });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
