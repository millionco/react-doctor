import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  EVALUATION_CONFIG_CONTRACT,
  MATERIALIZE_ALL_RULES_CONFIG_COMMAND,
  MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND,
  PREPARE_PAIRED_REACT_DOCTOR_COMMANDS,
  SCAN_COMMAND,
} from "../src/constants.js";

const temporaryDirectories: string[] = [];
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;
const normalizeEmbeddedPath = (filePath: string): string => filePath.replaceAll("\\", "/");

interface BuildCommandEnvironmentInput {
  reactDoctorDirectory: string;
  targetDirectory: string;
  targetRootDirectory?: string;
  ruleKeys?: ReadonlyArray<string>;
}

const buildCommandEnvironment = ({
  reactDoctorDirectory,
  targetDirectory,
  targetRootDirectory = ".",
  ruleKeys = [],
}: BuildCommandEnvironmentInput): NodeJS.ProcessEnv => ({
  ...process.env,
  REACT_DOCTOR_WORK_DIRECTORY: normalizeEmbeddedPath(reactDoctorDirectory),
  REACT_DOCTOR_RULE_KEYS: JSON.stringify(ruleKeys),
  TARGET_CHECKOUT_DIRECTORY: normalizeEmbeddedPath(targetDirectory),
  TARGET_ROOT_DIRECTORY: targetRootDirectory,
});

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("MATERIALIZE_ALL_RULES_CONFIG_COMMAND", () => {
  it("keeps paired snapshot build steps valid as Dockerfile RUN instructions", () => {
    expect(PREPARE_PAIRED_REACT_DOCTOR_COMMANDS).not.toEqual(
      expect.arrayContaining([expect.stringContaining("\n")]),
    );
  });

  it("normalizes Windows paths before embedding them in JavaScript", () => {
    expect(normalizeEmbeddedPath("C:\\Users\\runner\\repo")).toBe("C:/Users/runner/repo");
  });

  it("keeps diagnostic findings advisory so nonzero exits mean execution failure", () => {
    expect(SCAN_COMMAND).toContain("--blocking none");
  });

  it(
    "enables every revision-local rule at a normalized severity",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      const targetRootDirectory = path.join(targetDirectory, "app");
      const nestedProjectDirectory = path.join(targetRootDirectory, "packages/nested");
      const ignoredProjectDirectory = path.join(targetRootDirectory, "node_modules/dependency");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(nestedProjectDirectory, { recursive: true });
      fs.mkdirSync(ignoredProjectDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        `export const REACT_COMPILER_RULES = { "react-hooks-js/compiler-rule": "warn" };
export const REACT_DOCTOR_RULES = [
  { key: "react-doctor/default-rule", rule: { isScanRule: false } },
  { key: "react-doctor/opt-in-rule", rule: { isScanRule: false } },
];
`,
      );
      fs.writeFileSync(path.join(nestedProjectDirectory, "package.json"), "{}");
      fs.writeFileSync(path.join(ignoredProjectDirectory, "package.json"), "{}");
      fs.writeFileSync(path.join(targetRootDirectory, "doctor.config.ts"), "export default {};");
      fs.writeFileSync(path.join(nestedProjectDirectory, "doctor.config.ts"), "export default {};");

      execFileSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          targetRootDirectory: "app",
        }),
      });

      expect(fs.readFileSync(path.join(targetRootDirectory, "doctor.config.ts"), "utf8")).toBe(
        `export default ${JSON.stringify({
          adoptExistingLintConfig: false,
          respectInlineDisables: false,
          rules: {
            "react-doctor/default-rule": "error",
            "react-doctor/opt-in-rule": "error",
            "react-hooks-js/compiler-rule": "error",
          },
          warnings: true,
        })};\n`,
      );
      expect(fs.readFileSync(path.join(nestedProjectDirectory, "doctor.config.ts"), "utf8")).toBe(
        fs.readFileSync(path.join(targetRootDirectory, "doctor.config.ts"), "utf8"),
      );
      expect(fs.existsSync(path.join(ignoredProjectDirectory, "doctor.config.ts"))).toBe(false);
    },
  );

  it(
    "enables only explicitly selected revision-local rules",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        `export const REACT_COMPILER_RULES = { "react-hooks-js/compiler-rule": "warn" };
export const REACT_DOCTOR_RULES = [
  { key: "react-doctor/selected-rule", rule: { isScanRule: false } },
  { key: "react-doctor/unselected-rule", rule: { isScanRule: false } },
];
`,
      );

      execFileSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          ruleKeys: ["react-doctor/selected-rule"],
        }),
      });

      expect(fs.readFileSync(path.join(targetDirectory, "doctor.config.ts"), "utf8")).toBe(
        `export default ${JSON.stringify({
          adoptExistingLintConfig: false,
          respectInlineDisables: false,
          ignore: { tags: ["security-scan"] },
          rules: {
            "react-doctor/selected-rule": "error",
            "react-doctor/unselected-rule": "off",
            "react-hooks-js/compiler-rule": "off",
          },
          warnings: true,
        })};\n`,
      );
    },
  );

  it(
    "freezes the exact detector revision and revision-local rule configuration",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const provenancePath = path.join(temporaryDirectory, "evaluation-provenance.json");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        `export const REACT_COMPILER_RULES = { "react-hooks-js/compiler-rule": "warn" };
export const REACT_DOCTOR_RULES = [
  { key: "react-doctor/no-derived-useState", rule: { isScanRule: false } },
  { key: "react-doctor/security-rule", rule: { isScanRule: true } },
];
`,
      );
      execFileSync("git", ["-C", reactDoctorDirectory, "init", "-q"]);
      execFileSync("git", ["-C", reactDoctorDirectory, "config", "user.email", "test@example.com"]);
      execFileSync("git", ["-C", reactDoctorDirectory, "config", "user.name", "Test"]);
      execFileSync("git", ["-C", reactDoctorDirectory, "add", "."]);
      execFileSync("git", ["-C", reactDoctorDirectory, "commit", "-q", "-m", "fixture"]);
      const expectedCommit = execFileSync(
        "git",
        ["-C", reactDoctorDirectory, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim();
      execFileSync("sh", ["-c", MATERIALIZE_REACT_DOCTOR_EVALUATION_PROVENANCE_COMMAND], {
        env: {
          ...process.env,
          REACT_DOCTOR_REPOSITORY: "https://github.com/millionco/react-doctor.git",
          REACT_DOCTOR_RULE_KEYS: JSON.stringify(["react-doctor/no-derived-useState"]),
          REACT_DOCTOR_WORK_DIRECTORY: normalizeEmbeddedPath(reactDoctorDirectory),
          REACT_DOCTOR_EVALUATION_PROVENANCE_PATH: normalizeEmbeddedPath(provenancePath),
        },
      });

      expect(JSON.parse(fs.readFileSync(provenancePath, "utf8"))).toEqual({
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorCommit: expectedCommit,
        configContract: EVALUATION_CONFIG_CONTRACT,
        ruleSetHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        ruleKeys: ["react-doctor/no-derived-useState"],
      });
    },
  );

  it(
    "keeps the security scan enabled when a scan rule is selected",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        `export const REACT_COMPILER_RULES = {};
export const REACT_DOCTOR_RULES = [
  { key: "react-doctor/scan-rule", rule: { isScanRule: true } },
  { key: "react-doctor/lint-rule", rule: { isScanRule: false } },
];
`,
      );

      execFileSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          ruleKeys: ["react-doctor/scan-rule"],
        }),
      });

      expect(fs.readFileSync(path.join(targetDirectory, "doctor.config.ts"), "utf8")).toBe(
        `export default ${JSON.stringify({
          adoptExistingLintConfig: false,
          respectInlineDisables: false,
          rules: {
            "react-doctor/lint-rule": "off",
            "react-doctor/scan-rule": "error",
          },
          warnings: true,
        })};\n`,
      );
    },
  );

  it(
    "rejects selected rules missing from the evaluated revision",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        "export const REACT_COMPILER_RULES = {}; export const REACT_DOCTOR_RULES = [];",
      );

      const result = spawnSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        encoding: "utf8",
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          ruleKeys: ["react-doctor/missing-rule"],
        }),
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Unknown React Doctor eval rules");
      expect(fs.existsSync(path.join(targetDirectory, "doctor.config.ts"))).toBe(false);
    },
  );

  it(
    "atomically replaces config symlinks without following them",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      const targetRootDirectory = path.join(targetDirectory, "app");
      const symlinkTargetPath = path.join(temporaryDirectory, "outside-config.ts");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(targetRootDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        "export const REACT_COMPILER_RULES = {}; export const REACT_DOCTOR_RULES = [];",
      );
      fs.writeFileSync(symlinkTargetPath, "sentinel");
      fs.symlinkSync(symlinkTargetPath, path.join(targetRootDirectory, "doctor.config.ts"));

      execFileSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          targetRootDirectory: "app",
        }),
      });

      expect(fs.readFileSync(symlinkTargetPath, "utf8")).toBe("sentinel");
      expect(fs.lstatSync(path.join(targetRootDirectory, "doctor.config.ts")).isFile()).toBe(true);
      expect(
        fs
          .readdirSync(targetRootDirectory)
          .some((fileName) => fileName.startsWith(".doctor.config.ts.")),
      ).toBe(false);
    },
  );

  it(
    "rejects a symlinked target root and does not write outside the checkout",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      const outsideDirectory = path.join(temporaryDirectory, "outside");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.mkdirSync(outsideDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        "export const REACT_COMPILER_RULES = {}; export const REACT_DOCTOR_RULES = [];",
      );
      fs.symlinkSync(outsideDirectory, path.join(targetDirectory, "app"));

      const result = spawnSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        encoding: "utf8",
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          targetRootDirectory: "app",
        }),
      });

      expect(result.status).not.toBe(0);
      expect(fs.existsSync(path.join(outsideDirectory, "doctor.config.ts"))).toBe(false);
    },
  );

  it(
    "fails safely when the config path is not a replaceable file",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      const targetRootDirectory = path.join(targetDirectory, "app");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(path.join(targetRootDirectory, "doctor.config.ts"), { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        "export const REACT_COMPILER_RULES = {}; export const REACT_DOCTOR_RULES = [];",
      );

      const result = spawnSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        encoding: "utf8",
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          targetRootDirectory: "app",
        }),
      });

      expect(result.status).not.toBe(0);
      expect(fs.lstatSync(path.join(targetRootDirectory, "doctor.config.ts")).isDirectory()).toBe(
        true,
      );
      expect(
        fs
          .readdirSync(targetRootDirectory)
          .some((fileName) => fileName.startsWith(".doctor.config.ts.")),
      ).toBe(false);
    },
  );

  it(
    "does not traverse symlinked child directories",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const reactDoctorDirectory = path.join(temporaryDirectory, "react-doctor");
      const pluginDirectory = path.join(
        reactDoctorDirectory,
        "packages/oxlint-plugin-react-doctor/dist",
      );
      const targetDirectory = path.join(temporaryDirectory, "target");
      const targetRootDirectory = path.join(targetDirectory, "app");
      const outsideDirectory = path.join(temporaryDirectory, "outside");
      fs.mkdirSync(pluginDirectory, { recursive: true });
      fs.mkdirSync(targetRootDirectory, { recursive: true });
      fs.mkdirSync(outsideDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDirectory, "index.js"),
        "export const REACT_COMPILER_RULES = {}; export const REACT_DOCTOR_RULES = [];",
      );
      fs.writeFileSync(path.join(outsideDirectory, "package.json"), "{}");
      fs.symlinkSync(outsideDirectory, path.join(targetRootDirectory, "linked-package"));

      execFileSync("sh", ["-c", MATERIALIZE_ALL_RULES_CONFIG_COMMAND], {
        env: buildCommandEnvironment({
          reactDoctorDirectory,
          targetDirectory,
          targetRootDirectory: "app",
        }),
      });

      expect(fs.existsSync(path.join(outsideDirectory, "doctor.config.ts"))).toBe(false);
    },
  );

  it(
    "fails without running the scan when config materialization fails",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-eval-"));
      temporaryDirectories.push(temporaryDirectory);
      const sentinelPath = path.join(temporaryDirectory, "scan-ran");
      const command = SCAN_COMMAND.replace(MATERIALIZE_ALL_RULES_CONFIG_COMMAND, "false").replace(
        /node "\$REACT_DOCTOR_WORK_DIRECTORY[\s\S]*$/,
        `touch "${sentinelPath}"`,
      );
      const result = spawnSync("sh", ["-c", command], {
        encoding: "utf8",
        env: {
          ...process.env,
          REACT_DOCTOR_WORK_DIRECTORY: "/workspace/react-doctor",
          REACT_DOCTOR_RULE_KEYS: "[]",
          TARGET_CHECKOUT_DIRECTORY: "/workspace/target",
          TARGET_ROOT_DIRECTORY: ".",
          SANDBOX_REPORT_PATH: "/tmp/report.json",
        },
      });

      expect(result.status).not.toBe(0);
      expect(fs.existsSync(sentinelPath)).toBe(false);
    },
  );

  it(
    "fails when the target root environment variable is unset",
    { timeout: INTEGRATION_TEST_TIMEOUT_MS },
    () => {
      const command = SCAN_COMMAND.replace(MATERIALIZE_ALL_RULES_CONFIG_COMMAND, "true").replace(
        'node "$REACT_DOCTOR_WORK_DIRECTORY/packages/react-doctor/bin/react-doctor.js"',
        "true",
      );
      const environment = {
        ...process.env,
        REACT_DOCTOR_WORK_DIRECTORY: "/workspace/react-doctor",
        REACT_DOCTOR_RULE_KEYS: "[]",
        TARGET_CHECKOUT_DIRECTORY: "/workspace/target",
        SANDBOX_REPORT_PATH: "/tmp/report.json",
      };
      Reflect.deleteProperty(environment, "TARGET_ROOT_DIRECTORY");

      const result = spawnSync("sh", ["-c", command], { encoding: "utf8", env: environment });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("TARGET_ROOT_DIRECTORY");
    },
  );
});
