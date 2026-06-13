import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { clearConfigCache, loadConfigWithSource } from "@react-doctor/core";
import type { ReactDoctorConfig } from "@react-doctor/core";

const loadConfig = async (rootDirectory: string): Promise<ReactDoctorConfig | null> => {
  clearConfigCache();
  return (await loadConfigWithSource(rootDirectory))?.config ?? null;
};

const tempRootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-config-test-"));

afterAll(() => {
  fs.rmSync(tempRootDirectory, { recursive: true, force: true });
});

describe("loadConfig", () => {
  describe("doctor.config.json", () => {
    let configDirectory: string;

    beforeAll(() => {
      configDirectory = path.join(tempRootDirectory, "with-config-file");
      fs.mkdirSync(configDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(configDirectory, "doctor.config.json"),
        JSON.stringify({
          ignore: {
            rules: ["react/no-danger", "react-doctor/no-giant-component"],
            files: ["src/generated/**"],
          },
        }),
      );
    });

    it("loads config from doctor.config.json", async () => {
      const config = await loadConfig(configDirectory);
      expect(config).toEqual({
        ignore: {
          rules: ["react/no-danger", "react-doctor/no-giant-component"],
          files: ["src/generated/**"],
        },
      });
    });
  });

  describe("doctor.config.ts", () => {
    it("loads a TypeScript config via jiti", async () => {
      const tsConfigDirectory = path.join(tempRootDirectory, "with-ts-config");
      fs.mkdirSync(tsConfigDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(tsConfigDirectory, "doctor.config.ts"),
        'export default {\n  lint: true,\n  rules: { "react-doctor/no-danger": "off" },\n};\n',
      );
      const config = await loadConfig(tsConfigDirectory);
      expect(config).toEqual({ lint: true, rules: { "react-doctor/no-danger": "off" } });
    });

    it("loads a config with a runtime import from react-doctor/api without local node_modules", async () => {
      const selfImportDirectory = path.join(tempRootDirectory, "with-self-import-config");
      fs.mkdirSync(selfImportDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(selfImportDirectory, "doctor.config.ts"),
        'import { defineConfig } from "react-doctor/api";\n\nexport default defineConfig({\n  textComponents: ["Text", "Trans"],\n  rawTextWrapperComponents: ["Button", "ButtonLink", "Tag"],\n});\n',
      );
      const config = await loadConfig(selfImportDirectory);
      expect(config).toEqual({
        textComponents: ["Text", "Trans"],
        rawTextWrapperComponents: ["Button", "ButtonLink", "Tag"],
      });
    });

    it("warns and returns null when a config imports an unresolvable package", async () => {
      const missingImportDirectory = path.join(tempRootDirectory, "with-missing-import-config");
      fs.mkdirSync(missingImportDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(missingImportDirectory, "doctor.config.ts"),
        'import { somethingMissing } from "package-that-does-not-exist";\n\nexport default { lint: somethingMissing };\n',
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(missingImportDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load"));
      warnSpy.mockRestore();
    });

    it("does not rescue a missing package whose name merely contains react-doctor", async () => {
      const lookalikeImportDirectory = path.join(tempRootDirectory, "with-lookalike-import-config");
      fs.mkdirSync(lookalikeImportDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(lookalikeImportDirectory, "doctor.config.ts"),
        'import { rules } from "@acme/react-doctor-rules";\n\nexport default { rules };\n',
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(lookalikeImportDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("@acme/react-doctor-rules"));
      warnSpy.mockRestore();
    });

    it("does not rescue an import from the bare react-doctor specifier", async () => {
      const bareImportDirectory = path.join(tempRootDirectory, "with-bare-self-import-config");
      fs.mkdirSync(bareImportDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(bareImportDirectory, "doctor.config.ts"),
        'import { defineConfig } from "react-doctor";\n\nexport default defineConfig({ lint: true });\n',
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(bareImportDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load"));
      warnSpy.mockRestore();
    });

    it("prefers doctor.config.ts over doctor.config.json", async () => {
      const mixedDirectory = path.join(tempRootDirectory, "ts-over-json");
      fs.mkdirSync(mixedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(mixedDirectory, "doctor.config.ts"),
        "export default { lint: true };\n",
      );
      fs.writeFileSync(
        path.join(mixedDirectory, "doctor.config.json"),
        JSON.stringify({ lint: false }),
      );
      const config = await loadConfig(mixedDirectory);
      expect(config?.lint).toBe(true);
    });
  });

  describe("JSONC tolerance", () => {
    it("parses comments and trailing commas in doctor.config.json", async () => {
      const jsoncDirectory = path.join(tempRootDirectory, "with-jsonc");
      fs.mkdirSync(jsoncDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(jsoncDirectory, "doctor.config.json"),
        '{\n  // disable a noisy rule\n  "rules": { "react-doctor/no-danger": "off", },\n}\n',
      );
      const config = await loadConfig(jsoncDirectory);
      expect(config).toEqual({ rules: { "react-doctor/no-danger": "off" } });
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

    it("loads config from package.json reactDoctor key", async () => {
      const config = await loadConfig(packageJsonDirectory);
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
        path.join(precedenceDirectory, "doctor.config.json"),
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

    it("prefers doctor.config.json over package.json", async () => {
      const config = await loadConfig(precedenceDirectory);
      expect(config?.ignore?.rules).toEqual(["from-config-file"]);
    });
  });

  describe("no config", () => {
    let emptyDirectory: string;

    beforeAll(() => {
      emptyDirectory = path.join(tempRootDirectory, "no-config");
      fs.mkdirSync(emptyDirectory, { recursive: true });
    });

    it("returns null when no config is found", async () => {
      const config = await loadConfig(emptyDirectory);
      expect(config).toBeNull();
    });

    it("returns null when config path is a directory instead of a file (EISDIR)", async () => {
      const directoryConfigRoot = path.join(tempRootDirectory, "eisdir-config");
      fs.mkdirSync(directoryConfigRoot, { recursive: true });
      fs.mkdirSync(path.join(directoryConfigRoot, "doctor.config.json"), { recursive: true });
      fs.mkdirSync(path.join(directoryConfigRoot, "package.json"), { recursive: true });

      const config = await loadConfig(directoryConfigRoot);
      expect(config).toBeNull();
    });
  });

  describe("legacy react-doctor.config.json fallback", () => {
    it("reads a legacy react-doctor.config.json as a deprecated fallback and warns", async () => {
      const legacyDirectory = path.join(tempRootDirectory, "legacy-config");
      fs.mkdirSync(legacyDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(legacyDirectory, "react-doctor.config.json"),
        JSON.stringify({ lint: true }),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(legacyDirectory);
      expect(config).toEqual({ lint: true });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("react-doctor.config.json"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
      warnSpy.mockRestore();
    });

    it("prefers doctor.config.json over a legacy react-doctor.config.json", async () => {
      const legacyPrecedenceDirectory = path.join(tempRootDirectory, "legacy-precedence");
      fs.mkdirSync(legacyPrecedenceDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(legacyPrecedenceDirectory, "doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-current"] } }),
      );
      fs.writeFileSync(
        path.join(legacyPrecedenceDirectory, "react-doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-legacy"] } }),
      );
      const config = await loadConfig(legacyPrecedenceDirectory);
      expect(config?.ignore?.rules).toEqual(["from-current"]);
    });

    it("prefers package.json reactDoctor over a legacy react-doctor.config.json", async () => {
      const legacyPkgDirectory = path.join(tempRootDirectory, "legacy-vs-pkg");
      fs.mkdirSync(legacyPkgDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(legacyPkgDirectory, "package.json"),
        JSON.stringify({ name: "test", reactDoctor: { ignore: { rules: ["from-pkg"] } } }),
      );
      fs.writeFileSync(
        path.join(legacyPkgDirectory, "react-doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-legacy"] } }),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(legacyPkgDirectory);
      expect(config?.ignore?.rules).toEqual(["from-pkg"]);
      warnSpy.mockRestore();
    });

    it("inherits a legacy react-doctor.config.json from an ancestor directory", async () => {
      const ancestorDirectory = path.join(tempRootDirectory, "legacy-ancestor");
      const childDirectory = path.join(ancestorDirectory, "packages", "ui");
      fs.mkdirSync(childDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(ancestorDirectory, "react-doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-legacy-root"] } }),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(childDirectory);
      expect(config?.ignore?.rules).toEqual(["from-legacy-root"]);
      warnSpy.mockRestore();
    });

    it("warns and returns null when the legacy file is malformed", async () => {
      const brokenLegacyDirectory = path.join(tempRootDirectory, "legacy-broken");
      fs.mkdirSync(brokenLegacyDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(brokenLegacyDirectory, "react-doctor.config.json"),
        "not valid json{{{",
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(brokenLegacyDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load"));
      warnSpy.mockRestore();
    });

    it("does not inherit an ancestor config when a child legacy file is broken", async () => {
      const ancestorDirectory = path.join(tempRootDirectory, "legacy-broken-child-ancestor");
      const childDirectory = path.join(ancestorDirectory, "packages", "ui");
      fs.mkdirSync(childDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(ancestorDirectory, "doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-ancestor"] } }),
      );
      fs.writeFileSync(path.join(childDirectory, "react-doctor.config.json"), "not valid json{{{");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(childDirectory);
      expect(config).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe("scan options in config", () => {
    let optionsDirectory: string;

    beforeAll(() => {
      optionsDirectory = path.join(tempRootDirectory, "with-scan-options");
      fs.mkdirSync(optionsDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(optionsDirectory, "doctor.config.json"),
        JSON.stringify({
          ignore: { rules: ["react/no-danger"] },
          lint: true,
          verbose: true,
          diff: "main",
        }),
      );
    });

    it("loads scan options alongside ignore config", async () => {
      const config = await loadConfig(optionsDirectory);
      expect(config).toEqual({
        ignore: { rules: ["react/no-danger"] },
        lint: true,
        verbose: true,
        diff: "main",
      });
    });

    it("loads diff as boolean", async () => {
      const boolDiffDirectory = path.join(tempRootDirectory, "with-bool-diff");
      fs.mkdirSync(boolDiffDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(boolDiffDirectory, "doctor.config.json"),
        JSON.stringify({ diff: true }),
      );
      const config = await loadConfig(boolDiffDirectory);
      expect(config?.diff).toBe(true);
    });
  });

  describe("invalid config", () => {
    let invalidJsonDirectory: string;
    let nonObjectDirectory: string;

    beforeAll(() => {
      invalidJsonDirectory = path.join(tempRootDirectory, "invalid-json");
      fs.mkdirSync(invalidJsonDirectory, { recursive: true });
      fs.writeFileSync(path.join(invalidJsonDirectory, "doctor.config.json"), "not valid json{{{");

      nonObjectDirectory = path.join(tempRootDirectory, "non-object-config");
      fs.mkdirSync(nonObjectDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nonObjectDirectory, "doctor.config.json"),
        JSON.stringify([1, 2, 3]),
      );
    });

    it("returns null and warns for malformed JSON", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(invalidJsonDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to load"));
      warnSpy.mockRestore();
    });

    it("returns null and warns when config is not an object", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(nonObjectDirectory);
      expect(config).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("must export an object"));
      warnSpy.mockRestore();
    });

    it("falls through to package.json when config file has malformed JSON", async () => {
      const fallbackDirectory = path.join(tempRootDirectory, "malformed-with-fallback");
      fs.mkdirSync(fallbackDirectory, { recursive: true });
      fs.writeFileSync(path.join(fallbackDirectory, "doctor.config.json"), "not valid json{{{");
      fs.writeFileSync(
        path.join(fallbackDirectory, "package.json"),
        JSON.stringify({
          name: "test",
          reactDoctor: { ignore: { rules: ["from-fallback"] } },
        }),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const config = await loadConfig(fallbackDirectory);
      expect(config).toEqual({ ignore: { rules: ["from-fallback"] } });
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("falls through to package.json when config file is not an object", async () => {
      const nonObjectFallbackDirectory = path.join(tempRootDirectory, "non-object-with-fallback");
      fs.mkdirSync(nonObjectFallbackDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nonObjectFallbackDirectory, "doctor.config.json"),
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
      const config = await loadConfig(nonObjectFallbackDirectory);
      expect(config).toEqual({ ignore: { rules: ["from-non-object-fallback"] } });
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("ignores non-object reactDoctor key in package.json", async () => {
      const arrayConfigDirectory = path.join(tempRootDirectory, "array-pkg-config");
      fs.mkdirSync(arrayConfigDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(arrayConfigDirectory, "package.json"),
        JSON.stringify({ name: "test", reactDoctor: "not-an-object" }),
      );
      const config = await loadConfig(arrayConfigDirectory);
      expect(config).toBeNull();
    });
  });

  describe("loadConfigWithSource", () => {
    it("returns the directory the config was loaded from", async () => {
      const sourceDir = path.join(tempRootDirectory, "with-source");
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, "doctor.config.json"),
        JSON.stringify({ rootDir: "apps/web" }),
      );
      clearConfigCache();
      const loaded = await loadConfigWithSource(sourceDir);
      expect(loaded?.sourceDirectory).toBe(sourceDir);
      expect(loaded?.config.rootDir).toBe("apps/web");
      expect(loaded?.format).toBe("json");
      expect(loaded?.configFilePath).toBe(path.join(sourceDir, "doctor.config.json"));
    });

    it("returns the ancestor directory when the config lives upstream", async () => {
      const ancestorDir = path.join(tempRootDirectory, "with-source-ancestor");
      const childDir = path.join(ancestorDir, "packages", "ui");
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(
        path.join(ancestorDir, "doctor.config.json"),
        JSON.stringify({ rootDir: "apps/web" }),
      );
      clearConfigCache();
      const loaded = await loadConfigWithSource(childDir);
      expect(loaded?.sourceDirectory).toBe(ancestorDir);
    });

    it("does not inherit an ancestor config when the child config is unparseable", async () => {
      const ancestorDir = path.join(tempRootDirectory, "broken-child-ancestor");
      const childDir = path.join(ancestorDir, "packages", "ui");
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(
        path.join(ancestorDir, "doctor.config.json"),
        JSON.stringify({ rootDir: "apps/web" }),
      );
      fs.writeFileSync(path.join(childDir, "doctor.config.json"), "not valid json{{{");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      clearConfigCache();
      const loaded = await loadConfigWithSource(childDir);
      expect(loaded).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe("rootDir validation", () => {
    it("strips a non-string rootDir and warns", async () => {
      const badRootDirDir = path.join(tempRootDirectory, "bad-root-dir");
      fs.mkdirSync(badRootDirDir, { recursive: true });
      fs.writeFileSync(
        path.join(badRootDirDir, "doctor.config.json"),
        JSON.stringify({ rootDir: 42 }),
      );
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const config = await loadConfig(badRootDirDir);
      expect(config?.rootDir).toBeUndefined();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining(`config field "rootDir" must be a string`),
      );
      stderrSpy.mockRestore();
    });

    it("preserves a valid string rootDir untouched", async () => {
      const goodRootDirDir = path.join(tempRootDirectory, "good-root-dir");
      fs.mkdirSync(goodRootDirDir, { recursive: true });
      fs.writeFileSync(
        path.join(goodRootDirDir, "doctor.config.json"),
        JSON.stringify({ rootDir: "apps/web" }),
      );
      const config = await loadConfig(goodRootDirDir);
      expect(config?.rootDir).toBe("apps/web");
    });
  });

  describe("ancestor config inheritance", () => {
    it("finds config from parent directory when not present locally", async () => {
      const parentDirectory = path.join(tempRootDirectory, "monorepo-inherit");
      const childDirectory = path.join(parentDirectory, "packages", "ui");
      fs.mkdirSync(childDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(parentDirectory, "doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-monorepo-root"] } }),
      );

      const config = await loadConfig(childDirectory);
      expect(config).toEqual({ ignore: { rules: ["from-monorepo-root"] } });
    });

    it("prefers local config over ancestor config", async () => {
      const parentDirectory = path.join(tempRootDirectory, "monorepo-local-wins");
      const childDirectory = path.join(parentDirectory, "packages", "ui");
      fs.mkdirSync(childDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(parentDirectory, "doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-parent"] } }),
      );
      fs.writeFileSync(
        path.join(childDirectory, "doctor.config.json"),
        JSON.stringify({ ignore: { rules: ["from-child"] } }),
      );

      const config = await loadConfig(childDirectory);
      expect(config).toEqual({ ignore: { rules: ["from-child"] } });
    });

    it("finds config from package.json reactDoctor key in ancestor", async () => {
      const parentDirectory = path.join(tempRootDirectory, "monorepo-pkg-inherit");
      const childDirectory = path.join(parentDirectory, "packages", "app");
      fs.mkdirSync(childDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(parentDirectory, "package.json"),
        JSON.stringify({
          name: "monorepo",
          reactDoctor: { customRulesOnly: true },
        }),
      );

      const config = await loadConfig(childDirectory);
      expect(config).toEqual({ customRulesOnly: true });
    });

    it("returns null when no config exists anywhere in the ancestor chain", async () => {
      const isolatedDirectory = path.join(tempRootDirectory, "no-config-anywhere", "deep", "path");
      fs.mkdirSync(isolatedDirectory, { recursive: true });

      const config = await loadConfig(isolatedDirectory);
      expect(config).toBeNull();
    });
  });
});
