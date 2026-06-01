import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
  const projectRoot = mkdtempSync(path.join(tmpdir(), "react-doctor-rules-"));
  writeFileSync(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  return {
    projectRoot,
    configPath: path.join(projectRoot, "react-doctor.config.json"),
    packageJsonPath: path.join(projectRoot, "package.json"),
    cleanup: () => rmSync(projectRoot, { recursive: true, force: true }),
  };
};

const readJsonFile = (filePath: string): Record<string, unknown> =>
  JSON.parse(readFileSync(filePath, "utf8"));

const captureLog = <Result>(run: () => Result): { result: Result; output: string } => {
  const lines: string[] = [];
  const consoleObject = globalThis.console as unknown as Record<string, unknown>;
  const originalLog = consoleObject.log;
  consoleObject.log = (...args: unknown[]): void => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    return { result: run(), output: lines.join("\n") };
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
  it("creates a schema-stamped config when none exists", () => {
    fixture = setupFixture();
    rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(true);
    const config = readJsonFile(fixture.configPath);
    expect(config.$schema).toBe("https://react.doctor/schema/config.json");
    expect(config.rules).toEqual({ "react-doctor/no-danger": "off" });
    expect(process.exitCode).toBe(0);
  });

  it("accepts the bare rule id and a legacy key", () => {
    fixture = setupFixture();
    rulesSetAction("no-danger", "error", { cwd: fixture.projectRoot });
    rulesSetAction("react/no-array-index-key", "warn", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    expect(config.rules).toMatchObject({
      "react-doctor/no-danger": "error",
      "react-doctor/no-array-index-key": "warn",
    });
  });

  it("preserves unrelated config fields", () => {
    fixture = setupFixture();
    writeFileSync(
      fixture.configPath,
      JSON.stringify({ lint: true, rules: { "react-doctor/no-eval": "warn" } }, null, 2),
    );
    rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    expect(config.lint).toBe(true);
    expect(config.rules).toMatchObject({
      "react-doctor/no-eval": "warn",
      "react-doctor/no-danger": "off",
    });
  });

  it("enable uses the rule's recommended severity by default", () => {
    fixture = setupFixture();
    rulesEnableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    const severity = (config.rules as Record<string, string>)["react-doctor/no-danger"];
    expect(["warn", "error"]).toContain(severity);
  });

  it("rejects an invalid severity without writing a config", () => {
    fixture = setupFixture();
    rulesSetAction("react-doctor/no-danger", "loud", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("rejects an unknown rule without writing a config", () => {
    fixture = setupFixture();
    rulesDisableAction("react-doctor/not-a-real-rule", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe("rules config embedded in package.json", () => {
  it("updates the package.json reactDoctor block instead of creating a file", () => {
    fixture = setupFixture({ name: "fixture", reactDoctor: { lint: true } });
    rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(false);
    const packageJson = readJsonFile(fixture.packageJsonPath);
    expect(packageJson.reactDoctor).toMatchObject({
      lint: true,
      rules: { "react-doctor/no-danger": "off" },
    });
  });
});

describe("rules config with an unparseable config file", () => {
  it("writes package.json#reactDoctor and leaves the broken config file untouched", () => {
    fixture = setupFixture({ name: "fixture", reactDoctor: { lint: true } });
    const brokenConfig = "{ not valid json";
    writeFileSync(fixture.configPath, brokenConfig);

    rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    // The broken file is left as-is — the scanner reads package.json#reactDoctor
    // when the config file fails to parse, so the mutation must not shadow it.
    expect(readFileSync(fixture.configPath, "utf8")).toBe(brokenConfig);
    const packageJson = readJsonFile(fixture.packageJsonPath);
    expect(packageJson.reactDoctor).toMatchObject({
      lint: true,
      rules: { "react-doctor/no-danger": "off" },
    });
  });
});

describe("rules category", () => {
  it("sets a category severity by case-insensitive match", () => {
    fixture = setupFixture();
    rulesCategoryAction("accessibility", "off", { cwd: fixture.projectRoot });

    const config = readJsonFile(fixture.configPath);
    expect(config.categories).toEqual({ Accessibility: "off" });
  });

  it("rejects an unknown category", () => {
    fixture = setupFixture();
    rulesCategoryAction("Nonsense", "off", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe("rules ignore-tag / unignore-tag", () => {
  it("ignores then unignores a known tag", () => {
    fixture = setupFixture();
    rulesIgnoreTagAction("design", { cwd: fixture.projectRoot });
    expect(readJsonFile(fixture.configPath).ignore).toEqual({ tags: ["design"] });

    rulesUnignoreTagAction("design", { cwd: fixture.projectRoot });
    expect(readJsonFile(fixture.configPath).ignore).toBeUndefined();
  });

  it("unignore-tag on a project that never ignored the tag is a no-op", () => {
    fixture = setupFixture();
    rulesUnignoreTagAction("design", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it("rejects an unknown tag", () => {
    fixture = setupFixture();
    rulesIgnoreTagAction("not-a-tag", { cwd: fixture.projectRoot });

    expect(existsSync(fixture.configPath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe("rules list / explain JSON output", () => {
  it("reflects the configured severity in `list --json`", () => {
    fixture = setupFixture();
    rulesDisableAction("react-doctor/no-danger", { cwd: fixture.projectRoot });

    const { output } = captureLog(() =>
      rulesListAction({ json: true, configured: true, cwd: fixture.projectRoot }),
    );
    const payload = JSON.parse(output) as Array<{ key: string; severity: string; source: string }>;
    const entry = payload.find((row) => row.key === "react-doctor/no-danger");
    expect(entry).toMatchObject({ severity: "off", source: "rule" });
  });

  it("ignores invalid config severities the scanner would drop", () => {
    fixture = setupFixture();
    writeFileSync(
      fixture.configPath,
      JSON.stringify({ rules: { "react-doctor/no-danger": "warning" } }, null, 2),
    );

    const { output } = captureLog(() =>
      rulesExplainAction("react-doctor/no-danger", { json: true, cwd: fixture.projectRoot }),
    );
    const payload = JSON.parse(output) as { severity: string; source: string };
    // `"warning"` is not a valid severity; validateConfigTypes drops it, so the
    // rule falls back to its registry default rather than reporting "warning".
    expect(payload.source).toBe("default");
    expect(["warn", "error", "off"]).toContain(payload.severity);
  });

  it("explains a rule as JSON with a learn-more URL", () => {
    fixture = setupFixture();
    const { output } = captureLog(() =>
      rulesExplainAction("react-doctor/no-danger", { json: true, cwd: fixture.projectRoot }),
    );
    const payload = JSON.parse(output) as { key: string; learnMoreUrl: string };
    expect(payload.key).toBe("react-doctor/no-danger");
    expect(payload.learnMoreUrl).toContain("/prompts/rules/react-doctor/no-danger.md");
  });

  it("reports an unknown rule for explain", () => {
    fixture = setupFixture();
    rulesExplainAction("react-doctor/nope", { cwd: fixture.projectRoot });
    expect(process.exitCode).toBe(1);
  });
});
