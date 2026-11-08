import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

describe.each(["Panel", "panel", "_Panel", "$Panel", "πanel", "Écran"])(
  "display-name named default export %s",
  (componentName) => {
    it("uses the declared name by default", () => {
      const result = runRule(
        displayName,
        `export default function ${componentName}() { return <section />; }`,
        { settings: { "react-doctor": { portedRuleMode: "strict" } } },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([false, true])("respects ignoreTranspilerName=%s", (ignoreTranspilerName) => {
      const result = runRule(
        displayName,
        `export default function ${componentName}() { return <section />; }`,
        {
          settings: {
            "react-doctor": { portedRuleMode: "strict", displayName: { ignoreTranspilerName } },
          },
        },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(ignoreTranspilerName ? 1 : 0);
    });
  },
);

describe("display-name named default export boundaries", () => {
  it.each([
    "export default function Panel() { return <>Content</>; }",
    "import React from 'react'; export default function Panel() { return React.createElement('section'); }",
    "export default async function Panel() { return <section />; }",
  ])("uses the declared component name: %s", (code) => {
    const result = runRule(displayName, code, {
      settings: { "react-doctor": { portedRuleMode: "strict" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts an explicit display name when inferred names are disabled", () => {
    const result = runRule(
      displayName,
      "export default function panel() { return <section />; } panel.displayName = 'Panel';",
      {
        settings: {
          "react-doctor": { portedRuleMode: "strict", displayName: { ignoreTranspilerName: true } },
        },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "export default function () { return <section />; }",
    "import React from 'react'; export default function () { return React.createElement('section'); }",
    "export default () => <section />;",
    "export default function () { function Panel() { return <section />; } return <Panel />; }",
  ])("keeps anonymous exports checked: %s", (code) => {
    const result = runRule(displayName, code, {
      settings: { "react-doctor": { portedRuleMode: "strict" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves curated behavior with inferred names disabled", () => {
    const result = runRule(displayName, "export default function panel() { return <section />; }", {
      settings: {
        "react-doctor": { portedRuleMode: "curated", displayName: { ignoreTranspilerName: true } },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves the render-output requirement", () => {
    const result = runRule(displayName, "export default function panel() { return 42; }", {
      settings: {
        "react-doctor": { portedRuleMode: "strict", displayName: { ignoreTranspilerName: true } },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
