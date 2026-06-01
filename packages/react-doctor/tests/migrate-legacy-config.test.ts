import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { clearConfigCache, findLegacyConfig, loadConfigWithSource } from "@react-doctor/core";
import { migrateLegacyConfig } from "../src/cli/utils/migrate-legacy-config.js";

const tempDirectories: string[] = [];

const createTempDirectory = (): string => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-migrate-"));
  tempDirectories.push(tempDirectory);
  return tempDirectory;
};

afterEach(() => {
  for (const tempDirectory of tempDirectories.splice(0)) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
  clearConfigCache();
});

describe("migrateLegacyConfig", () => {
  it("renames react-doctor.config.json to a typed doctor.config.ts that loads identically", async () => {
    const directory = createTempDirectory();
    const legacyFilePath = path.join(directory, "react-doctor.config.json");
    fs.writeFileSync(
      legacyFilePath,
      JSON.stringify({
        $schema: "https://react.doctor/schema/config.json",
        lint: true,
        rules: { "react-doctor/no-danger": "off" },
      }),
    );

    const legacy = findLegacyConfig(directory);
    if (!legacy) throw new Error("Expected to detect the legacy config");
    const migratedPath = migrateLegacyConfig(legacy);
    expect(migratedPath).toBe(path.join(directory, "doctor.config.ts"));
    if (!migratedPath) throw new Error("Expected a migrated path");

    // Legacy file is gone; the new file is a typed default export, no $schema.
    expect(fs.existsSync(legacyFilePath)).toBe(false);
    const written = fs.readFileSync(migratedPath, "utf8");
    expect(written).toContain('import type { ReactDoctorConfig } from "react-doctor/api"');
    expect(written).toContain("satisfies ReactDoctorConfig");
    expect(written).not.toContain("$schema");
    // Idiomatic TS: identifier keys unquoted, rule keys quoted.
    expect(written).toContain("lint: true");
    expect(written).toContain("rules: {");
    expect(written).toContain('"react-doctor/no-danger": "off"');

    // The generated TS round-trips through the loader to the same settings.
    clearConfigCache();
    const loaded = await loadConfigWithSource(directory);
    expect(loaded?.format).toBe("module");
    expect(loaded?.config).toEqual({ lint: true, rules: { "react-doctor/no-danger": "off" } });
  });

  it("leaves an unparseable legacy file untouched", () => {
    const directory = createTempDirectory();
    const legacyFilePath = path.join(directory, "react-doctor.config.json");
    fs.writeFileSync(legacyFilePath, "{ not valid json");

    const migratedPath = migrateLegacyConfig({ legacyFilePath, directory });

    expect(migratedPath).toBeNull();
    expect(fs.existsSync(legacyFilePath)).toBe(true);
    expect(fs.existsSync(path.join(directory, "doctor.config.ts"))).toBe(false);
  });
});

describe("findLegacyConfig", () => {
  it("detects a lone react-doctor.config.json", () => {
    const directory = createTempDirectory();
    fs.writeFileSync(
      path.join(directory, "react-doctor.config.json"),
      JSON.stringify({ lint: true }),
    );
    expect(findLegacyConfig(directory)?.directory).toBe(directory);
  });

  it("returns null when a doctor.config.* already supersedes the legacy file", () => {
    const directory = createTempDirectory();
    fs.writeFileSync(
      path.join(directory, "react-doctor.config.json"),
      JSON.stringify({ lint: true }),
    );
    fs.writeFileSync(path.join(directory, "doctor.config.json"), JSON.stringify({ lint: true }));
    expect(findLegacyConfig(directory)).toBeNull();
  });

  it("returns null when package.json#reactDoctor supersedes the legacy file", () => {
    const directory = createTempDirectory();
    fs.writeFileSync(
      path.join(directory, "react-doctor.config.json"),
      JSON.stringify({ lint: true }),
    );
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ reactDoctor: { lint: true } }),
    );
    expect(findLegacyConfig(directory)).toBeNull();
  });

  it("finds a legacy file in an ancestor, stopping at the project boundary", () => {
    const root = createTempDirectory();
    fs.writeFileSync(path.join(root, "react-doctor.config.json"), JSON.stringify({ lint: true }));
    fs.mkdirSync(path.join(root, ".git"));
    const child = path.join(root, "packages", "ui");
    fs.mkdirSync(child, { recursive: true });
    expect(findLegacyConfig(child)?.directory).toBe(root);
  });
});
