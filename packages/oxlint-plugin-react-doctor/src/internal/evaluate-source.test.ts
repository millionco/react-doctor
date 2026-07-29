import { describe, expect, it } from "vite-plus/test";
import { buttonHasType } from "../plugin/rules/react-builtins/button-has-type.js";
import { runRule } from "../test-utils/run-rule.js";
import { evaluateSource } from "./evaluate-source.js";

const SOURCE_TEXT = `const label = "😀";
export const Component = () => <button>Save</button>;`;

describe("evaluateSource", () => {
  it("resolves stable rule IDs into canonical diagnostics with UTF-8 byte spans", () => {
    expect(
      evaluateSource({
        sourceText: SOURCE_TEXT,
        filename: "src/component.tsx",
        ruleIds: ["button-has-type"],
      }),
    ).toEqual({
      diagnostics: [
        {
          filePath: "src/component.tsx",
          plugin: "react-doctor",
          rule: "button-has-type",
          severity: "warning",
          title: "Button missing explicit type",
          message:
            "Your users can submit the form by accident because a `<button>` with no `type` defaults to submit.",
          help: 'Set an explicit button `type` so plain buttons do not submit forms by accident: `type="button"`, `"submit"`, or `"reset"`.',
          line: 2,
          column: 33,
          offset: 54,
          length: 6,
          endLine: 2,
          endColumn: 39,
          category: "Bugs",
        },
      ],
      failures: [],
    });
  });

  it("preserves existing runRule message and node-type behavior", () => {
    const evaluatorResult = evaluateSource({
      sourceText: SOURCE_TEXT,
      filename: "src/component.tsx",
      ruleIds: ["button-has-type"],
    });
    const testkitResult = runRule(buttonHasType, SOURCE_TEXT, {
      filename: "src/component.tsx",
    });

    expect(
      evaluatorResult.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        nodeType: "JSXIdentifier",
      })),
    ).toEqual(testkitResult.diagnostics);
    expect(testkitResult.parseErrors).toEqual([]);
  });

  it("keeps Oxlint suppression handling out of the legacy runRule testkit", () => {
    const sourceText =
      "// oxlint-disable-next-line react-doctor/button-has-type\nexport const Component = () => <button>Save</button>;";

    expect(
      evaluateSource({
        sourceText,
        filename: "src/component.tsx",
        ruleIds: ["button-has-type"],
      }),
    ).toEqual({ diagnostics: [], failures: [] });
    expect(
      runRule(buttonHasType, sourceText, {
        filename: "src/component.tsx",
      }).diagnostics,
    ).toHaveLength(1);
  });

  it("forwards the existing rule settings bag unchanged", () => {
    const sourceText = `export const Component = () => <button type="button">Save</button>;`;
    const defaultResult = evaluateSource({
      sourceText,
      filename: "src/component.tsx",
      ruleIds: ["button-has-type"],
    });
    const configuredResult = evaluateSource({
      sourceText,
      filename: "src/component.tsx",
      ruleIds: ["button-has-type"],
      settings: {
        "react-doctor": {
          buttonHasType: { button: false },
        },
      },
    });

    expect(defaultResult).toEqual({ diagnostics: [], failures: [] });
    expect(configuredResult.diagnostics).toHaveLength(1);
    expect(configuredResult.diagnostics[0]?.rule).toBe("button-has-type");
    expect(configuredResult.failures).toEqual([]);
  });

  it("uses capability settings for conditional recommendations", () => {
    const result = evaluateSource({
      sourceText: `"use client";\nconst apiToken = "sk_live_${"1".repeat(24)}";`,
      filename: "src/config.tsx",
      ruleIds: ["no-secrets-in-client-code"],
      settings: {
        "react-doctor": {
          capabilities: ["vite"],
        },
      },
    });

    expect(result.diagnostics[0]?.help).toBe(
      "Move secrets to server-only code. In Vite, only `VITE_*` env vars are exposed to the browser, and they must not contain secrets",
    );
    expect(result.failures).toEqual([]);
  });

  it("preserves default framework tokens while honoring explicit React Native settings", () => {
    const sourceText = `import { Image } from "react-native";
export const Component = () => <Image>Caption</Image>;`;
    const reactNativeSettings = {
      "react-doctor": {
        capabilities: ["react", "react-native"],
        framework: "react-native",
      },
    };
    const webSettings = {
      "react-doctor": {
        capabilities: ["react", "vite"],
        framework: "vite",
      },
    };
    const defaultResult = evaluateSource({
      sourceText,
      filename: "src/component.tsx",
      ruleIds: ["rn-no-image-children"],
    });
    const reactNativeResult = evaluateSource({
      sourceText,
      filename: "src/component.tsx",
      ruleIds: ["rn-no-image-children"],
      settings: reactNativeSettings,
    });
    const webResult = evaluateSource({
      sourceText,
      filename: "src/component.tsx",
      ruleIds: ["rn-no-image-children"],
      settings: webSettings,
    });
    const webExtensionResult = evaluateSource({
      sourceText,
      filename: "src/component.web.tsx",
      ruleIds: ["rn-no-image-children"],
      settings: reactNativeSettings,
    });

    expect(defaultResult.failures).toEqual([]);
    expect(defaultResult.diagnostics).toHaveLength(1);
    expect(reactNativeResult).toEqual(defaultResult);
    expect(webResult).toEqual({ diagnostics: [], failures: [] });
    expect(webExtensionResult).toEqual({ diagnostics: [], failures: [] });
  });

  it("returns Oxlint source order while preserving duplicate rule executions", () => {
    const result = evaluateSource({
      sourceText: `export const Component = () => <button accessKey="s">Save</button>;`,
      filename: "src/component.tsx",
      ruleIds: ["no-access-key", "button-has-type", "no-access-key"],
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "button-has-type",
      "no-access-key",
      "no-access-key",
    ]);
    expect(result.failures).toEqual([]);
  });

  it("returns explicit unknown, unsupported, and parse failures without executing rules", () => {
    expect(
      evaluateSource({
        sourceText: "const =",
        filename: "src/broken.ts",
        ruleIds: ["toString", "active-static-asset", "no-barrel-import", "button-has-type"],
      }),
    ).toEqual({
      diagnostics: [],
      failures: [
        {
          kind: "unknown-rule",
          filePath: "src/broken.ts",
          rule: "toString",
          message: "Unknown React Doctor rule: toString",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/broken.ts",
          rule: "active-static-asset",
          message: "Rule requires a project host: active-static-asset",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/broken.ts",
          rule: "no-barrel-import",
          message: "Rule requires a project host: no-barrel-import",
        },
        {
          kind: "parse",
          filePath: "src/broken.ts",
          message: "Unexpected token",
          line: 1,
          column: 7,
          offset: 6,
          length: 1,
        },
      ],
    });
    expect(runRule(buttonHasType, "const =", { filename: "src/broken.ts" }).parseErrors).toEqual([
      { message: "Unexpected token" },
    ]);
  });

  it("isolates a crashing rule and continues evaluating later rules", () => {
    const settings = Object.defineProperty({}, "react-doctor", {
      get: () => {
        throw new Error("settings unavailable");
      },
    });

    expect(
      evaluateSource({
        sourceText: SOURCE_TEXT,
        filename: "src/component.tsx",
        ruleIds: ["button-has-type", "button-has-type"],
        settings,
      }),
    ).toEqual({
      diagnostics: [],
      failures: [
        {
          kind: "rule-crash",
          filePath: "src/component.tsx",
          rule: "button-has-type",
          message: "settings unavailable",
        },
        {
          kind: "rule-crash",
          filePath: "src/component.tsx",
          rule: "button-has-type",
          message: "settings unavailable",
        },
      ],
    });
  });
});
