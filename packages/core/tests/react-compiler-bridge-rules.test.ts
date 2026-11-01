import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticPipeline } from "@react-doctor/core";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import {
  buildOxlintStdout,
  buildProject,
  TEST_ROOT_DIRECTORY,
} from "./helpers/oxlint-parse-harness.js";

const SET_STATE_IN_EFFECT_REASON =
  "Calling setState synchronously within an effect can trigger cascading renders";
const SET_STATE_IN_EFFECT_DETAIL =
  "Effects are intended to synchronize state between React and external systems such as manually updating the DOM, state management libraries, or other platform APIs.";
const BRIDGE_RULE_KEY = "react-doctor/forwarded-set-state-in-effect";
const COMPILER_RULE_KEY = "react-hooks-js/set-state-in-effect";

const parseSingleDiagnostic = (code: string) => {
  const stdout = buildOxlintStdout(
    code,
    `${SET_STATE_IN_EFFECT_REASON}\n\n${SET_STATE_IN_EFFECT_DETAIL}`,
  );
  const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);
  return diagnostic;
};

const buildConfig = (
  options: Partial<Parameters<typeof createOxlintConfig>[0]> = {},
): ReturnType<typeof createOxlintConfig> =>
  createOxlintConfig({
    pluginPath: "/tmp/plugin.js",
    project: buildProject({ framework: "vite", hasReactCompiler: true }),
    ...options,
  });

describe("React Compiler bridge rules", () => {
  it("reports a forwarded setState write as the compiler's set-state-in-effect diagnostic", () => {
    const compilerDiagnostic = parseSingleDiagnostic("react-hooks-js(set-state-in-effect)");
    const bridgedDiagnostic = parseSingleDiagnostic("react-doctor(forwarded-set-state-in-effect)");

    expect(bridgedDiagnostic.plugin).toBe("react-hooks-js");
    expect(bridgedDiagnostic.rule).toBe("set-state-in-effect");
    expect(bridgedDiagnostic).toEqual({
      ...compilerDiagnostic,
      url: "https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect",
    });
  });

  it("enables the bridge rule at the compiler rule's severity", () => {
    const config = buildConfig();

    expect(config.rules[COMPILER_RULE_KEY]).toBeDefined();
    expect(config.rules[BRIDGE_RULE_KEY]).toBe(config.rules[COMPILER_RULE_KEY]);
  });

  it("keeps the bridge rule off without the React Compiler rules", () => {
    expect(
      buildConfig({
        project: buildProject({
          framework: "vite",
          hasReactCompiler: false,
          hasReactCompilerLintPlugin: false,
        }),
      }).rules,
    ).not.toHaveProperty(BRIDGE_RULE_KEY);
    expect(buildConfig({ disableReactHooksJsPlugin: true }).rules).not.toHaveProperty(
      BRIDGE_RULE_KEY,
    );
  });

  it("runs the bridge rule with the cross-file rules when the compiler rule is on", () => {
    const sidecarRules = buildConfig({ ruleSelection: "sidecar" }).rules;
    const cacheableRules = buildConfig({ ruleSelection: "cacheable" }).rules;

    expect(sidecarRules).not.toHaveProperty(COMPILER_RULE_KEY);
    expect(sidecarRules[BRIDGE_RULE_KEY]).toBe(cacheableRules[COMPILER_RULE_KEY]);
    expect(cacheableRules).not.toHaveProperty(BRIDGE_RULE_KEY);
  });

  it("follows severity overrides of the compiler rule and the bridge rule", () => {
    expect(
      buildConfig({ severityControls: { rules: { [COMPILER_RULE_KEY]: "off" } } }).rules,
    ).not.toHaveProperty(BRIDGE_RULE_KEY);
    expect(
      buildConfig({ severityControls: { rules: { [COMPILER_RULE_KEY]: "error" } } }).rules[
        BRIDGE_RULE_KEY
      ],
    ).toBe("error");
    expect(
      buildConfig({ severityControls: { rules: { [BRIDGE_RULE_KEY]: "off" } } }).rules,
    ).not.toHaveProperty(BRIDGE_RULE_KEY);
  });

  it("uses the canonical compiler severity when the internal bridge requests another severity", () => {
    const warningRules = buildConfig({
      severityControls: {
        rules: { [COMPILER_RULE_KEY]: "warn", [BRIDGE_RULE_KEY]: "error" },
      },
    }).rules;
    expect(warningRules[COMPILER_RULE_KEY]).toBe("warn");
    expect(warningRules[BRIDGE_RULE_KEY]).toBe("warn");

    const errorRules = buildConfig({
      severityControls: {
        rules: { [COMPILER_RULE_KEY]: "error", [BRIDGE_RULE_KEY]: "warn" },
      },
    }).rules;
    expect(errorRules[COMPILER_RULE_KEY]).toBe("error");
    expect(errorRules[BRIDGE_RULE_KEY]).toBe("error");
  });

  it("does not let an internal bridge override enable a disabled compiler rule", () => {
    const rules = buildConfig({
      severityControls: {
        rules: { [COMPILER_RULE_KEY]: "off", [BRIDGE_RULE_KEY]: "error" },
      },
    }).rules;
    expect(rules).not.toHaveProperty(COMPILER_RULE_KEY);
    expect(rules).not.toHaveProperty(BRIDGE_RULE_KEY);
  });

  it("uses the internal bridge off switch without disabling the compiler rule", () => {
    const rules = buildConfig({
      severityControls: {
        rules: { [COMPILER_RULE_KEY]: "error", [BRIDGE_RULE_KEY]: "off" },
      },
    }).rules;
    expect(rules[COMPILER_RULE_KEY]).toBe("error");
    expect(rules).not.toHaveProperty(BRIDGE_RULE_KEY);
  });

  it("keeps the bridge off when compiler loading falls back despite explicit severities", () => {
    const rules = buildConfig({
      disableReactHooksJsPlugin: true,
      severityControls: {
        rules: { [COMPILER_RULE_KEY]: "error", [BRIDGE_RULE_KEY]: "error" },
      },
    }).rules;
    expect(rules).not.toHaveProperty(COMPILER_RULE_KEY);
    expect(rules).not.toHaveProperty(BRIDGE_RULE_KEY);
  });

  it.each([
    "// eslint-disable-next-line react-hooks/set-state-in-effect",
    "// eslint-disable-next-line react-hooks-js/set-state-in-effect",
  ])("suppresses a bridged diagnostic with %s", (disableComment) => {
    const bridgedDiagnostic = parseSingleDiagnostic("react-doctor(forwarded-set-state-in-effect)");
    const lines = Array.from({ length: bridgedDiagnostic.line }, () => "");
    lines[bridgedDiagnostic.line - 2] = disableComment;
    lines[bridgedDiagnostic.line - 1] = "    assign(setValue, id);";
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: TEST_ROOT_DIRECTORY,
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => lines,
    });

    expect(pipeline.apply(bridgedDiagnostic)).toBeNull();
  });
});
