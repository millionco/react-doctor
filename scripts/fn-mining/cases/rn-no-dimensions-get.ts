import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `Dimensions.get("window")` reads the size once and goes
// stale on rotation. Variants probe binding shapes: alias imports,
// namespace access, inline require.
export const rnNoDimensionsGetCases: FnMiningCase[] = [
  {
    ruleId: "rn-no-dimensions-get",
    description: "canonical: Dimensions.get inside a component render",
    filePath: "src/screen.tsx",
    code: `
      import { Dimensions, View } from "react-native";
      const Screen = () => {
        const { width } = Dimensions.get("window");
        return <View style={{ width }} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-dimensions-get",
    description: "aliased import: import { Dimensions as Dims }",
    filePath: "src/screen.tsx",
    code: `
      import { Dimensions as Dims, View } from "react-native";
      const Screen = () => {
        const { width } = Dims.get("window");
        return <View style={{ width }} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-dimensions-get",
    description: "namespace access: RN.Dimensions.get(...)",
    filePath: "src/screen.tsx",
    code: `
      import * as RN from "react-native";
      const Screen = () => {
        const { width } = RN.Dimensions.get("window");
        return <RN.View style={{ width }} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-dimensions-get",
    description: 'inline require: require("react-native").Dimensions.get(...)',
    filePath: "src/screen.tsx",
    code: `
      const Screen = () => {
        const { width } = require("react-native").Dimensions.get("window");
        return <View style={{ width }} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-dimensions-get",
    description: 'removed API: Dimensions.addEventListener("change", handler)',
    filePath: "src/screen.tsx",
    code: `
      import { Dimensions } from "react-native";
      export const watchRotation = (handler: () => void) => {
        Dimensions.addEventListener("change", handler);
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "rn-no-dimensions-get",
    description: "module-level one-shot read (deliberate carve-out probe)",
    filePath: "src/screen.tsx",
    code: `
      import { Dimensions, View } from "react-native";
      const windowWidth = Dimensions.get("window").width;
      const Screen = () => <View style={{ width: windowWidth }} />;
    `,
    shouldFire: false,
    carveOutReason:
      "Module-level one-shot Dimensions.get reads are the documented FP carve-out — static layout constants do not go stale mid-render.",
  },
];
