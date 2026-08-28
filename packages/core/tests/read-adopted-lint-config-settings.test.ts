import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readAdoptedLintConfigSettings } from "../src/read-adopted-lint-config-settings.js";

describe("readAdoptedLintConfigSettings", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-test-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeJson = (filePath: string, content: unknown): void => {
    fs.writeFileSync(filePath, JSON.stringify(content));
  };

  it("returns empty object when no config paths provided", () => {
    const settings = readAdoptedLintConfigSettings([]);
    expect(settings).toEqual({});
  });

  it("extracts tailwindcss settings from .oxlintrc.json", () => {
    const configPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(configPath, {
      settings: {
        tailwindcss: {
          entryPoint: "src/styles.css",
        },
      },
    });

    const settings = readAdoptedLintConfigSettings([configPath]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: "src/styles.css",
      },
    });
  });

  it("skips react-doctor settings to avoid circular override", () => {
    const configPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(configPath, {
      settings: {
        "react-doctor": {
          framework: "next",
        },
        tailwindcss: {
          entryPoint: "src/styles.css",
        },
      },
    });

    const settings = readAdoptedLintConfigSettings([configPath]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: "src/styles.css",
      },
    });
  });

  it("merges settings from multiple config files", () => {
    const config1Path = path.join(temporaryDirectory, ".oxlintrc.json");
    const config2Path = path.join(temporaryDirectory, ".eslintrc.json");

    writeJson(config1Path, {
      settings: {
        tailwindcss: {
          entryPoint: "src/styles.css",
        },
      },
    });

    writeJson(config2Path, {
      settings: {
        "some-plugin": {
          option: "value",
        },
      },
    });

    const settings = readAdoptedLintConfigSettings([config1Path, config2Path]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: "src/styles.css",
      },
      "some-plugin": {
        option: "value",
      },
    });
  });

  it("handles JSONC comments in config files", () => {
    const configPath = path.join(temporaryDirectory, ".oxlintrc.json");
    fs.writeFileSync(
      configPath,
      `{
        // Line comment
        "settings": {
          /* Block comment */
          "tailwindcss": {
            "entryPoint": "src/styles.css"
          }
        }
      }`,
    );

    const settings = readAdoptedLintConfigSettings([configPath]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: "src/styles.css",
      },
    });
  });

  it("handles tailwindcss monorepo array format", () => {
    const configPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(configPath, {
      settings: {
        tailwindcss: {
          entryPoint: [
            { files: "apps/web/**/*.tsx", use: "apps/web/styles.css" },
            { files: "apps/docs/**/*.tsx", use: "apps/docs/styles.css" },
          ],
        },
      },
    });

    const settings = readAdoptedLintConfigSettings([configPath]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: [
          { files: "apps/web/**/*.tsx", use: "apps/web/styles.css" },
          { files: "apps/docs/**/*.tsx", use: "apps/docs/styles.css" },
        ],
      },
    });
  });

  it("gracefully skips files that cannot be read", () => {
    const validConfigPath = path.join(temporaryDirectory, ".oxlintrc.json");
    const invalidConfigPath = path.join(temporaryDirectory, "nonexistent.json");

    writeJson(validConfigPath, {
      settings: {
        tailwindcss: {
          entryPoint: "src/styles.css",
        },
      },
    });

    const settings = readAdoptedLintConfigSettings([invalidConfigPath, validConfigPath]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: "src/styles.css",
      },
    });
  });

  it("gracefully skips files with invalid JSON", () => {
    const validConfigPath = path.join(temporaryDirectory, "valid.json");
    const invalidConfigPath = path.join(temporaryDirectory, "invalid.json");

    writeJson(validConfigPath, {
      settings: {
        tailwindcss: {
          entryPoint: "src/styles.css",
        },
      },
    });

    fs.writeFileSync(invalidConfigPath, "{ invalid json");

    const settings = readAdoptedLintConfigSettings([invalidConfigPath, validConfigPath]);
    expect(settings).toEqual({
      tailwindcss: {
        entryPoint: "src/styles.css",
      },
    });
  });

  it("skips configs without settings field", () => {
    const configPath = path.join(temporaryDirectory, ".oxlintrc.json");
    writeJson(configPath, {
      rules: {
        "no-debugger": "error",
      },
    });

    const settings = readAdoptedLintConfigSettings([configPath]);
    expect(settings).toEqual({});
  });
});
