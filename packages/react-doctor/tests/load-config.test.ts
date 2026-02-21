import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/utils/load-config.js";

const tempRootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-config-test-"));

afterAll(() => {
  fs.rmSync(tempRootDirectory, { recursive: true, force: true });
});

describe("loadConfig", () => {
  describe("react-doctor.config.json", () => {
    let configDirectory: string;

    beforeAll(() => {
      configDirectory = path.join(tempRootDirectory, "with-config-file");
      fs.mkdirSync(configDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(configDirectory, "react-doctor.config.json"),
        JSON.stringify({
          ignore: {
            rules: ["react/no-danger", "knip/exports"],
            files: ["src/generated/**"],
          },
        }),
      );
    });

    it("loads config from react-doctor.config.json", () => {
      const config = loadConfig(configDirectory);
      expect(config).toEqual({
        ignore: {
          rules: ["react/no-danger", "knip/exports"],
          files: ["src/generated/**"],
        },
      });
    });
  });

  describe("package.json reactDoctor key", () => {
    let packageJsonDirectory: string;

    beforeAll(() => {
      packageJsonDirectory = path.join(tempRootDirectory, "with-package-json-config");
      fs.mkdirSync(packageJsonDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageJsonDirectory, "package.json"),
        JSON.stringify({
          name: "test-project",
          reactDoctor: {
            ignore: {
              rules: ["jsx-a11y/no-autofocus"],
            },
          },
        }),
      );
    });

    it("loads config from package.json reactDoctor key", () => {
      const config = loadConfig(packageJsonDirectory);
      expect(config).toEqual({
        ignore: {
          rules: ["jsx-a11y/no-autofocus"],
        },
      });
    });
  });

  describe("config file takes precedence", () => {
    let precedenceDirectory: string;

    beforeAll(() => {
      precedenceDirectory = path.join(tempRootDirectory, "precedence");
      fs.mkdirSync(precedenceDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(precedenceDirectory, "react-doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-config-file"] } }),
      );
      fs.writeFileSync(
        path.join(precedenceDirectory, "package.json"),
        JSON.stringify({
          name: "test",
          reactDoctor: { ignore: { rules: ["from-package-json"] } },
        }),
      );
    });

    it("prefers react-doctor.config.json over package.json", () => {
      const config = loadConfig(precedenceDirectory);
      expect(config?.ignore?.rules).toEqual(["from-config-file"]);
    });
  });

  describe("no config", () => {
    let emptyDirectory: string;

    beforeAll(() => {
      emptyDirectory = path.join(tempRootDirectory, "no-config");
      fs.mkdirSync(emptyDirectory, { recursive: true });
    });

    it("returns null when no config is found", () => {
      const config = loadConfig(emptyDirectory);
      expect(config).toBeNull();
    });
  });

  describe("scan options in config", () => {
    let optionsDirectory: string;

    beforeAll(() => {
      optionsDirectory = path.join(tempRootDirectory, "with-scan-options");
      fs.mkdirSync(optionsDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(optionsDirectory, "react-doctor.config.json"),
        JSON.stringify({
          ignore: { rules: ["react/no-danger"] },
          lint: true,
          deadCode: false,
          verbose: true,
          diff: "main",
        }),
      );
    });

    it("loads scan options alongside ignore config", () => {
      const config = loadConfig(optionsDirectory);
      expect(config).toEqual({
        ignore: { rules: ["react/no-danger"] },
        lint: true,
        deadCode: false,
        verbose: true,
        diff: "main",
      });
    });

    it("loads diff as boolean", () => {
      const boolDiffDirectory = path.join(tempRootDirectory, "with-bool-diff");
      fs.mkdirSync(boolDiffDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(boolDiffDirectory, "react-doctor.config.json"),
        JSON.stringify({ diff: true }),
      );
      const config = loadConfig(boolDiffDirectory);
      expect(config?.diff).toBe(true);
    });
  });

  describe("invalid config", () => {
    let invalidJsonDirectory: string;
    let nonObjectDirectory: string;

    beforeAll(() => {
      invalidJsonDirectory = path.join(tempRootDirectory, "invalid-json");
      fs.mkdirSync(invalidJsonDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(invalidJsonDirectory, "react-doctor.config.json"),
        "not valid json{{{",
      );

      nonObjectDirectory = path.join(tempRootDirectory, "non-object-config");
      fs.mkdirSync(nonObjectDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nonObjectDirectory, "react-doctor.config.json"),
        JSON.stringify([1, 2, 3]),
      );
    });

    it("returns null and warns for malformed JSON", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = loadConfig(invalidJsonDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"));
      warnSpy.mockRestore();
    });

    it("returns null and warns when config is not an object", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = loadConfig(nonObjectDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("must be a JSON object"));
      warnSpy.mockRestore();
    });

    it("falls through to package.json when config file has malformed JSON", () => {
      const fallbackDirectory = path.join(tempRootDirectory, "malformed-with-fallback");
      fs.mkdirSync(fallbackDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(fallbackDirectory, "react-doctor.config.json"),
        "not valid json{{{",
      );
      fs.writeFileSync(
        path.join(fallbackDirectory, "package.json"),
        JSON.stringify({
          name: "test",
          reactDoctor: { ignore: { rules: ["from-fallback"] } },
        }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = loadConfig(fallbackDirectory);
      expect(config).toEqual({ ignore: { rules: ["from-fallback"] } });
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("falls through to package.json when config file is not an object", () => {
      const nonObjectFallbackDirectory = path.join(tempRootDirectory, "non-object-with-fallback");
      fs.mkdirSync(nonObjectFallbackDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nonObjectFallbackDirectory, "react-doctor.config.json"),
        JSON.stringify([1, 2, 3]),
      );
      fs.writeFileSync(
        path.join(nonObjectFallbackDirectory, "package.json"),
        JSON.stringify({
          name: "test",
          reactDoctor: { ignore: { rules: ["from-non-object-fallback"] } },
        }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = loadConfig(nonObjectFallbackDirectory);
      expect(config).toEqual({ ignore: { rules: ["from-non-object-fallback"] } });
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("ignores non-object reactDoctor key in package.json", () => {
      const arrayConfigDirectory = path.join(tempRootDirectory, "array-pkg-config");
      fs.mkdirSync(arrayConfigDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(arrayConfigDirectory, "package.json"),
        JSON.stringify({ name: "test", reactDoctor: "not-an-object" }),
      );
      const config = loadConfig(arrayConfigDirectory);
      expect(config).toBeNull();
    });
  });
});
