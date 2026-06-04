import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { expoNoNonInlinedEnv } from "./expo-no-non-inlined-env.js";

const appFile = { filename: "src/screens/Home.tsx" };

describe("expo-no-non-inlined-env", () => {
  it("flags computed process.env[...] access", () => {
    const code = `const url = process.env["EXPO_PUBLIC_API_URL"];`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Computed");
  });

  it("flags computed process.env[variable] access", () => {
    const code = `const value = process.env[key];`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructuring of process.env", () => {
    const code = `const { EXPO_PUBLIC_API_URL } = process.env;`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Destructuring");
  });

  it("does NOT flag static dotted access", () => {
    const code = `const url = process.env.EXPO_PUBLIC_API_URL;`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag aliasing the whole env object", () => {
    const code = `const env = process.env;`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag computed access on an unrelated object", () => {
    const code = `const v = config.env[key];`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag in *.config.js (Node/build context)", () => {
    const code = `const { NODE_ENV } = process.env; const x = process.env[key];`;
    const result = runRule(expoNoNonInlinedEnv, code, { filename: "babel.config.js" });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag in scripts/ (tooling context)", () => {
    const code = `const value = process.env[key];`;
    const result = runRule(expoNoNonInlinedEnv, code, { filename: "scripts/build.ts" });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag in an Expo Router API route (+api)", () => {
    const code = `const { SECRET } = process.env;`;
    const result = runRule(expoNoNonInlinedEnv, code, { filename: "app/hello+api.ts" });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag in test files", () => {
    const code = `const value = process.env[key];`;
    const result = runRule(expoNoNonInlinedEnv, code, { filename: "src/Home.test.ts" });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag in server-only modules (*.server.*)", () => {
    const code = `const value = process.env[key];`;
    const result = runRule(expoNoNonInlinedEnv, code, { filename: "src/lib/db.server.ts" });
    expect(result.diagnostics).toHaveLength(0);
  });

  // Regression (RDE eval): runtime/tooling probes read non-EXPO_PUBLIC vars by
  // literal computed key (often behind a typeof guard) and expect them absent
  // in the bundle — not the inlinable-config bug this rule targets.
  it("does NOT flag a literal non-EXPO_PUBLIC computed key (runtime probe)", () => {
    const code = `const isJest = typeof process.env["JEST_WORKER_ID"] === "string";`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an optional-chained non-EXPO_PUBLIC literal key", () => {
    const code = `const debug = process.env?.["EXPO_DEBUG"] === "1";`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a literal EXPO_PUBLIC_ computed key", () => {
    const code = `const v = process.env["EXPO_PUBLIC_SECRET_TOKEN"];`;
    const result = runRule(expoNoNonInlinedEnv, code, appFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag in cli/ tooling files", () => {
    const code = `const level = process.env["EXPO_DEBUG"];`;
    const result = runRule(expoNoNonInlinedEnv, code, { filename: "packages/x/cli/logger.ts" });
    expect(result.diagnostics).toHaveLength(0);
  });
});
