import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const stockImport = 'import { BackHandler } from "react-native";';
const standardCleanup = "return subscription.remove;";

const checkCleanup = (
  providerImport: string,
  body: string,
  dependencies: Readonly<Record<string, string>> = { "react-native": "0.84.1" },
  filename = "Screen.tsx",
) => {
  const directory = mkdtempSync(join(tmpdir(), "react-doctor-back-handler-"));
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ dependencies }));
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
       ${providerImport}
       export function Screen() {
         useEffect(() => {
           const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
           ${body}
         }, []);
         return null;
       }`,
      { filename: join(directory, filename) },
    );
    expect(result.parseErrors).toEqual([]);
    return result.diagnostics.map(({ message }) => message);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("effect-needs-cleanup BackHandler removers", () => {
  it("recognizes the remover from a direct stock registration", () => {
    expect(checkCleanup(stockImport, standardCleanup)).toEqual([]);
  });

  it.each([
    ["a foreign provider", 'import { BackHandler } from "custom-events";', standardCleanup],
    [
      "a replacement remover",
      stockImport,
      "subscription.remove = () => {}; return subscription.remove;",
    ],
    ["a remover on a different handle", stockImport, "return differentSubscription.remove;"],
    [
      "an allocation with a falling-through exit",
      stockImport,
      "if (active) return subscription.remove;",
    ],
    ["an intervening call", stockImport, "notify(); return subscription.remove;"],
    [
      "an alternate module binding",
      `${stockImport} import * as Native from "react-native";`,
      standardCleanup,
    ],
  ])("still reports %s", (_name, provider, body) => {
    expect(checkCleanup(provider, body)).toEqual([
      expect.stringContaining("creates a subscription in useEffect without guaranteed cleanup"),
    ]);
  });

  it.each<[string, Readonly<Record<string, string>>, string]>([
    ["an aliased package", { "react-native": "npm:react-native-web@0.21.2" }, "Screen.tsx"],
    ["a browser adapter", { "react-native": "0.84.1", "react-native-web": "0.21.2" }, "Screen.tsx"],
    ["a browser file", { "react-native": "0.84.1" }, "Screen.web.tsx"],
  ])("still reports %s", (_name, dependencies, filename) => {
    expect(checkCleanup(stockImport, standardCleanup, dependencies, filename)).toHaveLength(1);
  });
});
