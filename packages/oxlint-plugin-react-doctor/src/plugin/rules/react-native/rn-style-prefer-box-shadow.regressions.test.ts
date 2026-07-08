import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnStylePreferBoxShadow } from "./rn-style-prefer-box-shadow.js";

describe("react-native/rn-style-prefer-boxshadow — regressions", () => {
  it("stays silent on the elevation + zIndex stacking idiom", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `const C = () => <Animated.View style={[{ zIndex: 4, elevation: 4 }, other]} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when one object covers both platforms", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `import { StyleSheet } from "react-native";
const styles = StyleSheet.create({
  card: { elevation: 4, shadowOffset: { height: 2, width: 0 }, shadowRadius: 4 },
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when both platforms are covered in one inline style", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `const C = () => (
  <View style={{ elevation: 3, zIndex: 3, shadowOpacity: 0.2, shadowRadius: 8 }} />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a sibling StyleSheet entry covers the other platform", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `import { StyleSheet } from "react-native";
const styles = StyleSheet.create({
  shadowContainer: { elevation: 4, shadowOffset: { height: 2, width: 0 }, shadowRadius: 4 },
});
const C = ({ shadowColor, shadowOpacity }) => (
  <View style={[styles.shadowContainer, { shadowColor, shadowOpacity }]} />
);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a sibling makeStyles entry covers the other platform", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `import { makeStyles } from "app/styles";
const useStyles = makeStyles(({ palette }) => ({
  shadowContainer: { elevation: 4, shadowOffset: { height: 2, width: 0 }, shadowRadius: 4 },
}));
const C = ({ shadowColor, shadowOpacity }) => {
  const styles = useStyles();
  return <Animated.View style={[styles.shadowContainer, { shadowColor, shadowOpacity }]} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an iOS-only inline shadow", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `const C = () => <View style={{ shadowColor: "#000", shadowRadius: 4 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an Android-only elevation shadow without zIndex", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `const C = () => <View style={{ elevation: 4, borderRadius: 8 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an iOS-only StyleSheet.create entry", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `import { StyleSheet } from "react-native";
const styles = StyleSheet.create({
  card: { shadowOpacity: 0.2, shadowRadius: 8 },
});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an iOS-only entry when the sibling has no elevation", () => {
    const result = runRule(
      rnStylePreferBoxShadow,
      `import { StyleSheet } from "react-native";
const styles = StyleSheet.create({
  container: { borderRadius: 8 },
});
const C = ({ shadowColor }) => <View style={[styles.container, { shadowColor }]} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
