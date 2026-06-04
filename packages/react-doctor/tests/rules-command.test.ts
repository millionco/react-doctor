import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import {
  rulesCategoryAction,
  rulesDisableAction,
  rulesEnableAction,
  rulesExplainAction,
  rulesIgnoreTagAction,
  rulesListAction,
  rulesSetAction,
  rulesUnignoreTagAction,
} from "../src/cli/commands/rules.js";

interface RulesCommandFixture {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly packageJsonPath: string;
  readonly cleanup: () => void;
}

const setupFixture = (
  packageJson: Record<string, unknown> = { name: "fixture" },
): RulesCommandFixture => {
  const projectRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-rules-"));
  fs.writeFileSync(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  return {
    projectRoot,
    configPath: path.join(projectRoot, "doctor.config.json"),
    packageJsonPath: path.join(projectRoot, "package.json"),
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  };
};

const readJsonFile = (filePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(filePath, "utf8"));

const captureLog = async (run: () => Promise<void> | void): Promise<string> => {
  const lines: string[] = [];
  const consoleObject = globalThis.console as unknown as Record<string, unknown>;
  const originalLog = consoleObject.log;
  consoleObject.log = (...args: unknown[]): void => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    await run();
    return lines.join("\n");
  } finally {
    consoleObject.log = originalLog;
  }
};

let fixture: RulesCommandFixture;
let restoreExitCode: number | string | null | undefined;

beforeEach(() => {
  restoreExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  fixture?.cleanup();
  // A validation error sets `process.exitCode = 1`; reset so the runner
  // doesn't inherit a non-zero exit from a deliberately-failing case.
  process.exitCode = restoreExitCode ?? 0;
});

describe("rules disable / set / enable", () => {
  it("creates a schema-stamped doctor.config.json when none exists", async () => {
    fixture = setupFixture();
    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(true);
    const config = readJsonFile(fixture.configPath);
    expect(config.$schema).toBe("https://react.doctor/schema/config.json");
    expect(config.rules).toEqual({ "react-doctor/no-danger": "off" });
    expect(process.exitCode).toBe(0);
  });

  it("accepts the bare rule id and a legacy key", async () => {
    fixture = setupFixture();
    await rulesSetAction("no-danger", "error", { cwd: fixture.projectRoot });
    await rulesSetAction("react/no-array-index-key", "warn", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    expect(config.rules).toMatchObject({
      "react-doctor/no-danger": "error",
      "react-doctor/no-array-index-key": "warn",
    });
  });

  it("preserves unrelated config fields", async () => {
    fixture = setupFixture();
    fs.writeFileSync(
      fixture.configPath,
      JSON.stringify({ lint: true, rules: { "react-doctor/no-eval": "warn" } }, null, 2),
    );
    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    expect(config.lint).toBe(true);
    expect(config.rules).toMatchObject({
      "react-doctor/no-eval": "warn",
      "react-doctor/no-danger": "off",
    });
  });

  it("enable uses the rule's recommended severity by default", async () => {
    fixture = setupFixture();
    await rulesEnableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    const severity = (config.rules as Record<string, string>)["react-doctor/no-danger"];
    expect(["warn", "error"]).toContain(severity);
  });

  it("rejects an invalid severity without writing a config", async () => {
    fixture = setupFixture();
    await rulesSetAction("react-doctor/no-danger", "loud", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("rejects an unknown rule without writing a config", async () => {
    fixture = setupFixture();
    await rulesDisableAction("react-doctor/not-a-real-rule", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe("rules config formats", () => {
  it("edits a doctor.config.ts in place, preserving the comment and other options", async () => {
    fixture = setupFixture();
    const tsConfigPath = path.join(fixture.projectRoot, "doctor.config.ts");
    fs.writeFileSync(tsConfigPath, "export default {\n  // keep this\n  lint: true,\n};\n");

    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const written = fs.readFileSync(tsConfigPath, "utf8");
    expect(written).toContain("// keep this");
    expect(written).toContain("lint: true");
    expect(written).toContain('"react-doctor/no-danger": "off"');
    // No JSON config created — the TS config was edited directly.
    expect(fs.existsSync(fixture.configPath)).toBe(false);
  });

  it("edits a doctor.config.ts that exports a const via `export default <name>`", async () => {
    fixture = setupFixture();
    const tsConfigPath = path.join(fixture.projectRoot, "doctor.config.ts");
    fs.writeFileSync(
      tsConfigPath,
      'import type { ReactDoctorConfig } from "react-doctor/api";\n\nconst config: ReactDoctorConfig = {\n  // keep this\n  lint: true,\n};\n\nexport default config;\n',
    );

    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const written = fs.readFileSync(tsConfigPath, "utf8");
    // The const indirection, its type annotation, the comment, and the other
    // option all survive — only the managed `rules` section was spliced in.
    expect(written).toContain("const config: ReactDoctorConfig");
    expect(written).toContain("// keep this");
    expect(written).toContain("lint: true");
    expect(written).toContain('"react-doctor/no-danger": "off"');
    expect(fs.existsSync(fixture.configPath)).toBe(false);
  });

  it("edits an inline `export default {…} satisfies` config (the migration output shape)", async () => {
    fixture = setupFixture();
    const tsConfigPath = path.join(fixture.projectRoot, "doctor.config.ts");
    // Byte-identical to what migrateLegacyConfig emits.
    fs.writeFileSync(
      tsConfigPath,
      'import type { ReactDoctorConfig } from "react-doctor/api";\n\nexport default {\n  lint: true\n} satisfies ReactDoctorConfig;\n',
    );

    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const written = fs.readFileSync(tsConfigPath, "utf8");
    // magicast unwraps the inline `satisfies` so the object is edited directly —
    // the `satisfies` wrapper and the other option survive, no fallback file.
    expect(written).toContain("satisfies ReactDoctorConfig");
    expect(written).toContain("lint: true");
    expect(written).toContain('"react-doctor/no-danger": "off"');
    expect(fs.existsSync(fixture.configPath)).toBe(false);
  });

  it("updates the package.json reactDoctor block instead of creating a file", async () => {
    fixture = setupFixture({ name: "fixture", reactDoctor: { lint: true } });
    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(false);
    const packageJson = readJsonFile(fixture.packageJsonPath);
    expect(packageJson.reactDoctor).toMatchObject({
      lint: true,
      rules: { "react-doctor/no-danger": "off" },
    });
  });

  it("writes package.json#reactDoctor and leaves an unparseable config file untouched", async () => {
    fixture = setupFixture({ name: "fixture", reactDoctor: { lint: true } });
    const brokenConfig = "{ not valid json";
    fs.writeFileSync(fixture.configPath, brokenConfig);

    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    // The broken file is left as-is — the scanner reads package.json#reactDoctor
    // when the config file fails to parse, so the mutation must not shadow it.
    expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(brokenConfig);
    const packageJson = readJsonFile(fixture.packageJsonPath);
    expect(packageJson.reactDoctor).toMatchObject({
      lint: true,
      rules: { "react-doctor/no-danger": "off" },
    });
  });
});

describe("rules category", () => {
  it("sets a category severity by case-insensitive match", async () => {
    fixture = setupFixture();
    await rulesCategoryAction("accessibility", "off", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    expect(config.categories).toEqual({ Accessibility: "off" });
  });

  it("rejects an unknown category", async () => {
    fixture = setupFixture();
    await rulesCategoryAction("Nonsense", "off", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe("rules ignore-tag / unignore-tag", () => {
  it("ignores then unignores a known tag", async () => {
    fixture = setupFixture();
    await rulesIgnoreTagAction("design", { cwd: fixture.projectRoot });
    expect(readJsonFile(fixture.configPath).ignore).toEqual({ tags: ["design"] });

    await rulesUnignoreTagAction("design", { cwd: fixture.projectRoot });
    expect(readJsonFile(fixture.configPath).ignore).toBeUndefined();
  });

  it("unignore-tag on a project that never ignored the tag is a no-op", async () => {
    fixture = setupFixture();
    await rulesUnignoreTagAction("design", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it("rejects an unknown tag", async () => {
    fixture = setupFixture();
    await rulesIgnoreTagAction("not-a-tag", { cwd: fixture.projectRoot });

    expect(fs.existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe("rules list / explain JSON output", () => {
  it("reflects the configured severity in `list --json`", async () => {
    fixture = setupFixture();
    await rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const output = await captureLog(() =>
      rulesListAction({ json: true, configured: true, cwd: fixture.projectRoot }),
    );
    const payload = JSON.parse(output) as Array<{ key: string; severity: string; source: string }>;
    const entry = payload.find((row) => row.key === "react-doctor/no-danger");
    expect(entry).toMatchObject({ severity: "off", source: "rule" });
  });

  it("ignores invalid config severities the scanner would drop", async () => {
    fixture = setupFixture();
    fs.writeFileSync(
      fixture.configPath,
      JSON.stringify({ rules: { "react-doctor/no-danger": "warning" } }, null, 2),
    );

    const output = await captureLog(() =>
      rulesExplainAction("react-doctor/no-danger", { json: true, cwd: fixture.projectRoot }),
    );
    const payload = JSON.parse(output) as { severity: string; source: string };
    // `"warning"` is not a valid severity; validateConfigTypes drops it, so the
    // rule falls back to its registry default rather than reporting "warning".
    expect(payload.source).toBe("default");
    expect(["warn", "error", "off"]).toContain(payload.severity);
  });

  it("explains a rule as JSON with a learn-more URL", async () => {
    fixture = setupFixture();
    const output = await captureLog(() =>
      rulesExplainAction("react-doctor/no-danger", { json: true, cwd: fixture.projectRoot }),
    );
    const payload = JSON.parse(output) as { key: string; learnMoreUrl: string };
    expect(payload.key).toBe("react-doctor/no-danger");
    expect(payload.learnMoreUrl).toContain("/docs/rules/react-doctor/no-danger");
  });

  it("reports an unknown rule for explain", async () => {
    fixture = setupFixture();
    await rulesExplainAction("react-doctor/nope", { cwd: fixture.projectRoot });
    expect(process.exitCode).toBe(1);
  });
});
