import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoDimensionsGet } from "./rn-no-dimensions-get.js";

describe("react-native/rn-no-dimensions-get — regressions", () => {
  it("stays silent on a local object named Dimensions", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const Dimensions = new Map([["a", 1]]); export const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags Dimensions.get imported from react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native"; export const w = () => Dimensions.get("window");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a CJS destructured require of react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const { Dimensions } = require("react-native");\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a CJS member require of react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const Dimensions = require("react-native").Dimensions;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions.addEventListener via CJS require", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const { Dimensions } = require("react-native");\nDimensions.addEventListener("change", () => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a bare global Dimensions.get", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `export const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an initializer-less let Dimensions later assigned from react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `let Dimensions;\nDimensions = require("react-native").Dimensions;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions destructured from a react-native namespace import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as ReactNative from "react-native";\nconst { Dimensions } = ReactNative;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions member-aliased from a react-native namespace import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as ReactNative from "react-native";\nconst Dimensions = ReactNative.Dimensions;\nexport const w = () => Dimensions.get("window").width;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on Dimensions member-aliased from an unrelated namespace import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as Store from "./my-dimensions-store";\nconst Dimensions = Store.Dimensions;\nexport const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on Dimensions imported from another module", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "./my-dimensions-store";\nexport const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on Dimensions required from another module", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const { Dimensions } = require("./my-dimensions-store");\nexport const value = Dimensions.get("a");`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a react-native import is shadowed by a function-local Map", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";\nexport const value = () => {\n  const Dimensions = new Map([["a", 1]]);\n  return Dimensions.get("a");\n};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a one-shot module-level read feeding style constants", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";\nconst dimensions = Dimensions.get("window");\nexport const MAX_WIDTH = dimensions.width - 48;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a module-level destructured read", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";\nconst { height } = Dimensions.get("screen");\nexport const FULL_DRAWER_HEIGHT = height;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent inside a makeStyles stylesheet-factory callback", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";
      import { makeStyles } from "app/styles";
      const useStyles = makeStyles(({ palette }) => ({
        unfurl: {
          width: Dimensions.get("window").width - 48,
          backgroundColor: palette.white,
        },
      }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent inside a createUseStyles factory callback", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";
      import { createUseStyles } from "react-jss";
      const useStyles = createUseStyles(() => ({
        root: { maxWidth: Dimensions.get("window").width },
      }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags Dimensions.get inside a component body", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";
      export const Card = () => {
        const { width } = Dimensions.get("window");
        return <View style={{ width }} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags Dimensions.get inside a hook body", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";
      export const useCardWidth = () => Dimensions.get("window").width / 2;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags module-level Dimensions.addEventListener", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";\nDimensions.addEventListener("change", () => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not claim users see a stale layout for a fresh read in an event handler", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native";
      function Card() {
        const onPress = () => {
          const { width } = Dimensions.get("window");
          logTapPosition(width);
        };
        return <Pressable onPress={onPress} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toContain("Your users see a stale layout");
    expect(result.diagnostics[0].message).toContain("never updates");
  });

  it("still flags Dimensions.get through an aliased import", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions as Dims, View } from "react-native";
      const Screen = () => {
        const { width } = Dims.get("window");
        return <View style={{ width }} />;
      };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags RN.Dimensions.get namespace access", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import * as RN from "react-native";
      const Screen = () => {
        const { width } = RN.Dimensions.get("window");
        return <RN.View style={{ width }} />;
      };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags inline require react-native Dimensions.get", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const Screen = () => {
        const { width } = require("react-native").Dimensions.get("window");
        return <View style={{ width }} />;
      };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
