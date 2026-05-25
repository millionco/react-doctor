import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoRawText } from "./rn-no-raw-text.js";

const runRnNoRawText = (code: string, rnNoRawTextSettings: Readonly<Record<string, unknown>>) =>
  runRule(rnNoRawText, code, {
    settings: { "react-doctor": { rnNoRawText: rnNoRawTextSettings } },
  });

describe("react-native/rn-no-raw-text — configured text containers", () => {
  it("allows raw text inside configured text components by leaf or full member name", () => {
    const leafResult = runRnNoRawText(
      "const App = () => <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>;",
      { textComponents: ["Label"] },
    );
    const fullResult = runRnNoRawText(
      "const App = () => <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>;",
      { textComponents: ["NativeTabs.Trigger.Label"] },
    );

    expect(leafResult.parseErrors).toEqual([]);
    expect(fullResult.parseErrors).toEqual([]);
    expect(leafResult.diagnostics).toEqual([]);
    expect(fullResult.diagnostics).toEqual([]);
  });

  it("still reports raw text inside non-configured components", () => {
    const result = runRnNoRawText("const App = () => <View>Hello</View>;", {
      textComponents: ["Typography"],
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows string-only configured wrapper children but reports mixed JSX children", () => {
    const stringOnlyResult = runRnNoRawText("const App = () => <Button>Cancel</Button>;", {
      rawTextWrapperComponents: ["Button"],
    });
    const templateResult = runRnNoRawText("const App = () => <Button>{`Save`}</Button>;", {
      rawTextWrapperComponents: ["Button"],
    });
    const mixedResult = runRnNoRawText("const App = () => <Button>Save<Icon /></Button>;", {
      rawTextWrapperComponents: ["Button"],
    });

    expect(stringOnlyResult.parseErrors).toEqual([]);
    expect(templateResult.parseErrors).toEqual([]);
    expect(mixedResult.parseErrors).toEqual([]);
    expect(stringOnlyResult.diagnostics).toEqual([]);
    expect(templateResult.diagnostics).toEqual([]);
    expect(mixedResult.diagnostics).toHaveLength(1);
  });

  it("does not let configured wrapper siblings suppress their parent raw text", () => {
    const result = runRnNoRawText(
      `const App = () => (
        <View>
          <Button>Inner</Button>
          Save
        </View>
      );`,
      { rawTextWrapperComponents: ["Button"] },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
