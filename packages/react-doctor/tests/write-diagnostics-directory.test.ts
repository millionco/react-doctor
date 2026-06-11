import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { writeDiagnosticsDirectory } from "../src/cli/utils/write-diagnostics-directory.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "rule",
  severity: "error",
  title: "Title",
  message: "Impact message.",
  help: "Fix it.",
  line: 1,
  column: 1,
  category: "Bugs",
  ...overrides,
});

describe("writeDiagnosticsDirectory", () => {
  it("writes to a fresh temp directory by default", () => {
    const directory = writeDiagnosticsDirectory([makeDiagnostic({})]);
    expect(directory.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(path.join(directory, "diagnostics.json"))).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("reuses a custom directory, replacing only the rule files the previous run wrote", () => {
    const customDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-custom-"));
    // User files must survive — even ones shaped like a rule dump.
    fs.writeFileSync(path.join(customDirectory, "readme.txt"), "keep me");
    fs.writeFileSync(path.join(customDirectory, "notes--draft.txt"), "keep me too");
    writeDiagnosticsDirectory([makeDiagnostic({ rule: "old-rule" })], customDirectory);
    expect(fs.existsSync(path.join(customDirectory, "react-doctor--old-rule.txt"))).toBe(true);

    const directory = writeDiagnosticsDirectory(
      [makeDiagnostic({ rule: "new-rule" })],
      customDirectory,
    );
    expect(directory).toBe(customDirectory);
    expect(fs.existsSync(path.join(customDirectory, "diagnostics.json"))).toBe(true);
    expect(fs.existsSync(path.join(customDirectory, "react-doctor--new-rule.txt"))).toBe(true);
    expect(fs.existsSync(path.join(customDirectory, "react-doctor--old-rule.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(customDirectory, "readme.txt"), "utf8")).toBe("keep me");
    expect(fs.readFileSync(path.join(customDirectory, "notes--draft.txt"), "utf8")).toBe(
      "keep me too",
    );
    fs.rmSync(customDirectory, { recursive: true, force: true });
  });

  it("resolves a relative custom directory against the working directory", () => {
    const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-relative-"));
    const previousWorkingDirectory = process.cwd();
    process.chdir(baseDirectory);
    try {
      const directory = writeDiagnosticsDirectory([makeDiagnostic({})], "nested/diagnostics");
      expect(directory).toBe(path.join(fs.realpathSync(baseDirectory), "nested", "diagnostics"));
      expect(fs.existsSync(path.join(directory, "diagnostics.json"))).toBe(true);
    } finally {
      process.chdir(previousWorkingDirectory);
      fs.rmSync(baseDirectory, { recursive: true, force: true });
    }
  });
});
