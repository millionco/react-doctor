import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { canOxlintExtendConfig } from "../src/can-oxlint-extend-config.js";
import { readAdoptedLintConfigSettings } from "../src/read-adopted-lint-config-settings.js";

describe("readAdoptedLintConfigSettings", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-settings-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeConfig = (filename: string, content: string): string => {
    const configPath = path.join(temporaryDirectory, filename);
    fs.writeFileSync(configPath, content);
    return configPath;
  };

  it("reads JSONC settings and skips react-doctor settings", () => {
    const configPath = writeConfig(
      ".oxlintrc.json",
      `{
        // Keep the Tailwind source path.
        "settings": {
          "react-doctor": { "framework": "next" },
          "tailwindcss": { "entryPoint": "src/styles.css" },
        },
      }`,
    );

    expect(readAdoptedLintConfigSettings([configPath])).toEqual({
      tailwindcss: { entryPoint: "src/styles.css" },
    });
  });

  it("reads settings from an ESLint config that Oxlint cannot extend", () => {
    const configPath = writeConfig(
      ".eslintrc.json",
      JSON.stringify({
        extends: ["next/core-web-vitals"],
        settings: { tailwindcss: { entryPoint: "src/styles.css" } },
      }),
    );

    expect(canOxlintExtendConfig(configPath)).toBe(false);
    expect(readAdoptedLintConfigSettings([configPath])).toEqual({
      tailwindcss: { entryPoint: "src/styles.css" },
    });
  });

  it("uses the last value when configs contain the same setting", () => {
    const firstConfigPath = writeConfig(
      "first.json",
      JSON.stringify({ settings: { tailwindcss: { entryPoint: "first.css" } } }),
    );
    const secondConfigPath = writeConfig(
      "second.json",
      JSON.stringify({
        settings: {
          tailwindcss: { entryPoint: "second.css" },
          "other-plugin": { option: true },
        },
      }),
    );

    expect(readAdoptedLintConfigSettings([firstConfigPath, secondConfigPath])).toEqual({
      tailwindcss: { entryPoint: "second.css" },
      "other-plugin": { option: true },
    });
  });

  it("skips missing, invalid, and non-settings configs", () => {
    const invalidConfigPath = writeConfig("invalid.json", "{ invalid json");
    const rulesOnlyConfigPath = writeConfig(
      "rules-only.json",
      JSON.stringify({ rules: { "no-debugger": "error" } }),
    );

    expect(
      readAdoptedLintConfigSettings([
        path.join(temporaryDirectory, "missing.json"),
        invalidConfigPath,
        rulesOnlyConfigPath,
      ]),
    ).toEqual({});
  });

  it("does not allow special keys to change the result prototype", () => {
    const configPath = writeConfig(
      ".oxlintrc.json",
      `{"settings":{"__proto__":{"polluted":true}}}`,
    );

    const settings = readAdoptedLintConfigSettings([configPath]);

    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    expect(Object.hasOwn(settings, "__proto__")).toBe(false);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
