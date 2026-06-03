import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import {
  findNearestPackageDirectory,
  hasDoctorScript,
  installDoctorScript,
} from "../src/cli/utils/install-doctor-script.js";

interface InstallDoctorScriptFixture {
  readonly projectRoot: string;
  readonly cleanup: () => void;
}

const setupFixture = (): InstallDoctorScriptFixture => {
  const projectRoot = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-script-"));
  return {
    projectRoot,
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  };
};

const writePackageJson = (projectRoot: string, value: Record<string, unknown>): void => {
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
};

const readPackageJson = (projectRoot: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

describe("installDoctorScript", () => {
  let fixture: InstallDoctorScriptFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("skips missing package.json without throwing", () => {
    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptStatus: "skipped",
      scriptReason: "missing-or-invalid-package-json",
    });
  });

  it("skips malformed package.json and leaves it unchanged", () => {
    const packageJsonPath = path.join(fixture.projectRoot, "package.json");
    fs.writeFileSync(packageJsonPath, "{ invalid json");

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result.scriptStatus).toBe("skipped");
    expect(fs.readFileSync(packageJsonPath, "utf8")).toBe("{ invalid json");
  });

  it("creates doctor when scripts are missing", () => {
    writePackageJson(fixture.projectRoot, { name: "app" });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptName: "doctor",
      scriptStatus: "created",
    });
    expect(readPackageJson(fixture.projectRoot)).toMatchObject({
      scripts: { doctor: "npx react-doctor@latest" },
    });
    expect(readPackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
  });

  it("writes to the nearest ancestor package.json when called from a nested directory", () => {
    writePackageJson(fixture.projectRoot, { name: "app" });
    const nestedDirectory = path.join(fixture.projectRoot, "src", "components");
    fs.mkdirSync(nestedDirectory, { recursive: true });

    const result = installDoctorScript({ projectRoot: nestedDirectory });

    expect(result.packageJsonPath).toBe(path.join(fixture.projectRoot, "package.json"));
    expect(readPackageJson(fixture.projectRoot)).toMatchObject({
      scripts: { doctor: "npx react-doctor@latest" },
    });
    expect(readPackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
  });

  it("stops nearest package lookup at the requested boundary when provided", () => {
    writePackageJson(fixture.projectRoot, { name: "parent" });
    const nestedDirectory = path.join(fixture.projectRoot, "nested");
    fs.mkdirSync(nestedDirectory, { recursive: true });

    expect(findNearestPackageDirectory(nestedDirectory, nestedDirectory)).toBeNull();
  });

  it("adds react-doctor fallback when doctor is taken", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: { doctor: "vitest --run" },
    });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptName: "react-doctor",
      scriptStatus: "created",
      scriptReason: "doctor-script-taken",
    });
    expect(readPackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "vitest --run",
      "react-doctor": "npx react-doctor@latest",
    });
  });

  it("skips the script when both script names are taken by other commands", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        doctor: "vitest --run",
        "react-doctor": "echo nope",
      },
    });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptStatus: "skipped",
      scriptReason: "script-names-taken",
    });
    expect(readPackageJson(fixture.projectRoot).scripts).toEqual({
      doctor: "vitest --run",
      "react-doctor": "echo nope",
    });
  });

  it("treats an existing react-doctor fallback command as setup", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {
        "react-doctor": "react-doctor --verbose",
      },
    });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptName: "react-doctor",
      scriptStatus: "existing",
    });
    expect(readPackageJson(fixture.projectRoot).scripts).toEqual({
      "react-doctor": "react-doctor --verbose",
    });
    expect(hasDoctorScript(fixture.projectRoot)).toBe(true);
  });

  it("skips only the script when scripts is not an object", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: "npm test",
    });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptStatus: "skipped",
      scriptReason: "invalid-scripts",
    });
    expect(readPackageJson(fixture.projectRoot)).toMatchObject({
      scripts: "npm test",
    });
    expect(readPackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
  });

  it("still creates the script when devDependencies is not an object", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {},
      devDependencies: "react-doctor",
    });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result).toMatchObject({
      scriptName: "doctor",
      scriptStatus: "created",
    });
    expect(readPackageJson(fixture.projectRoot)).toMatchObject({
      scripts: { doctor: "npx react-doctor@latest" },
      devDependencies: "react-doctor",
    });
  });

  it("does not add devDependency when react-doctor exists in another dependency field", () => {
    writePackageJson(fixture.projectRoot, {
      scripts: {},
      dependencies: {
        "react-doctor": "^1.2.3",
      },
    });

    const result = installDoctorScript({ projectRoot: fixture.projectRoot });

    expect(result.scriptStatus).toBe("created");
    expect(readPackageJson(fixture.projectRoot)).toMatchObject({
      scripts: { doctor: "npx react-doctor@latest" },
      dependencies: { "react-doctor": "^1.2.3" },
    });
    expect(readPackageJson(fixture.projectRoot)).not.toHaveProperty("devDependencies");
  });
});
