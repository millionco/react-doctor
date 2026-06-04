import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferPressableOverGestureDetector } from "./rn-prefer-pressable-over-gesture-detector.js";

describe("rn-prefer-pressable-over-gesture-detector", () => {
  it("flags GestureDetector wrapping plain Gesture.Tap()", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = () => (
        <GestureDetector gesture={Gesture.Tap()}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("GestureDetector");
  });

  it("flags variable-extracted Gesture.Tap() chain (binding analysis)", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ onPress }) => {
        const tap = Gesture.Tap().onStart(onPress).onEnd(onPress);
        return <GestureDetector gesture={tap}><Animated.View /></GestureDetector>;
      };
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag variable-extracted Gesture.Pan() chain", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Draggable = ({ onPan }) => {
        const pan = Gesture.Pan().onChange(onPan);
        return <GestureDetector gesture={pan}><Animated.View /></GestureDetector>;
      };
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag variable-extracted Gesture.Tap with numberOfTaps(2)", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ onPress }) => {
        const tap = Gesture.Tap().numberOfTaps(2).onStart(onPress);
        return <GestureDetector gesture={tap}><Animated.View /></GestureDetector>;
      };
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag variable-extracted Gesture.Race composition", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Combo = () => {
        const combo = Gesture.Race(Gesture.Tap(), Gesture.Pan());
        return <GestureDetector gesture={combo}><Animated.View /></GestureDetector>;
      };
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag variable initialized to an unknown identifier (no chain to follow)", () => {
    const code = `
      import { GestureDetector } from "react-native-gesture-handler";
      const Button = ({ gesture }) => (
        <GestureDetector gesture={gesture}><Animated.View /></GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags inline Gesture.Tap().onStart() chain", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ onPress }) => (
        <GestureDetector gesture={Gesture.Tap().onStart(onPress)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Gesture.Tap().numberOfTaps(1).onStart() chain", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ onPress }) => (
        <GestureDetector gesture={Gesture.Tap().numberOfTaps(1).onStart(onPress)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("regression: numberOfTaps(1).numberOfTaps(2) chain — outer wins, no false positive", () => {
    // The walker visits OUTERMOST → INNERMOST. In a fluent chain the
    // outermost `.numberOfTaps(2)` is the effective call (last
    // assignment wins). An earlier draft unconditionally overwrote
    // the captured value with each inner encounter and could flag
    // `.numberOfTaps(1).numberOfTaps(2)` as Pressable-eligible
    // (treating it as single-tap). The fix keeps only the FIRST
    // encountered value (= outermost).
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ onPress }) => (
        <GestureDetector gesture={Gesture.Tap().numberOfTaps(1).numberOfTaps(2).onStart(onPress)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("regression: numberOfTaps(<dynamic>) — bail conservatively, no false positive", () => {
    // Bugbot caught that the previous guard only rejected literal
    // numeric values > 1. A non-literal argument like
    // `numberOfTaps(config.taps)` fell through and was treated as
    // Pressable-eligible, even though the runtime value could be 2+.
    // Fix: any numberOfTaps call that isn't a static `1` literal bails.
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ config, onPress }) => (
        <GestureDetector gesture={Gesture.Tap().numberOfTaps(config.taps).onStart(onPress)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("regression: numberOfTaps(ternary) — bail conservatively", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ double, onPress }) => (
        <GestureDetector gesture={Gesture.Tap().numberOfTaps(double ? 2 : 1).onStart(onPress)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag double-tap (numberOfTaps(2))", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = ({ onPress }) => (
        <GestureDetector gesture={Gesture.Tap().numberOfTaps(2).onStart(onPress)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag Gesture.Pan() (pan is legit for GH)", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Draggable = () => (
        <GestureDetector gesture={Gesture.Pan().onChange(handlePan)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag Gesture.Pinch()", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Zoomable = () => (
        <GestureDetector gesture={Gesture.Pinch()}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag Gesture.Race composition", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Combo = () => (
        <GestureDetector gesture={Gesture.Race(Gesture.Tap(), Gesture.Pan())}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag tap chained with simultaneousWithExternalGesture", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Combo = ({ scroll }) => (
        <GestureDetector gesture={Gesture.Tap().simultaneousWithExternalGesture(scroll)}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a custom GestureDetector that isn't imported from RNGH", () => {
    const code = `
      import { GestureDetector, Gesture } from "./local-gesture";
      const Button = () => (
        <GestureDetector gesture={Gesture.Tap()}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag GestureDetector without any gesture prop (renders nothing)", () => {
    const code = `
      import { GestureDetector } from "react-native-gesture-handler";
      const Button = () => <GestureDetector><Animated.View /></GestureDetector>;
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inside testlike file (tags: test-noise)", () => {
    const code = `
      import { GestureDetector, Gesture } from "react-native-gesture-handler";
      const Button = () => (
        <GestureDetector gesture={Gesture.Tap()}>
          <Animated.View />
        </GestureDetector>
      );
    `;
    const result = runRule(rnPreferPressableOverGestureDetector, code, {
      filename: "Button.test.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
