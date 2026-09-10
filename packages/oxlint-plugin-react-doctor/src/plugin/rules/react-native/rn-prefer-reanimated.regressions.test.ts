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

  it("still flags Animated even with useNativeDriver (import-level heuristic)", () => {
    const result = runRule(
      rnPreferReanimated,
      `import { useEffect, useState } from 'react';
      import { Animated } from 'react-native';

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
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("may cause stutter");
    expect(result.diagnostics[0].message).toContain("useNativeDriver: true");
  });
});
