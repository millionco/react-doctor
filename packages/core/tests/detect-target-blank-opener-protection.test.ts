import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { getCapabilities } from "../src/project-info/capabilities.js";
import {
  detectTargetBlankOpenerProtection,
  isBrowserVersionAtLeast,
} from "../src/project-info/detect-target-blank-opener-protection.js";
import { clearProjectCache, discoverProject } from "../src/project-info/discover-project.js";
import type { PackageJson } from "../src/types/index.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-target-blank-protection-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

const setupProject = (caseName: string, packageJson: PackageJson): string => {
  const projectDirectory = path.join(temporaryRoot, caseName);
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, "package.json"), JSON.stringify(packageJson));
  return projectDirectory;
};

describe("detectTargetBlankOpenerProtection", () => {
  it("compares dotted browser versions by numeric segment", () => {
    expect(isBrowserVersionAtLeast("15.10", 15.5)).toBe(true);
    expect(isBrowserVersionAtLeast("15.4", 15.5)).toBe(false);
    expect(isBrowserVersionAtLeast("16", 15.5)).toBe(true);
    expect(isBrowserVersionAtLeast("15", 15.5)).toBe(false);
  });

  it("keeps IE 11 quiet because its noreferrer support is only partial", () => {
    const projectDirectory = setupProject("ie-11", {
      name: "ie-11",
      dependencies: { react: "^18.0.0" },
      browserslist: ["ie 11"],
    });

    const project = discoverProject(projectDirectory);
    const capabilities = getCapabilities(project);

    expect(capabilities.has("target-blank-needs-explicit-protection")).toBe(false);
    expect(capabilities.has("target-blank-needs-noreferrer")).toBe(false);
  });

  it("requires noopener for Chromium before implicit protection", () => {
    const packageJson: PackageJson = {
      name: "chrome-80",
      dependencies: { react: "^18.0.0" },
      browserslist: ["chrome 80"],
    };
    const projectDirectory = setupProject("chrome-80", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe("noopener");
    const capabilities = getCapabilities(discoverProject(projectDirectory));
    expect(capabilities.has("target-blank-needs-explicit-protection")).toBe(true);
    expect(capabilities.has("target-blank-needs-noreferrer")).toBe(false);
  });

  it("keeps modern browser targets ungated", () => {
    const packageJson: PackageJson = {
      name: "modern-chrome",
      browserslist: ["chrome >= 88"],
    };
    const projectDirectory = setupProject("modern-chrome", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBeUndefined();
  });

  it("refreshes Browserslist targets when the project cache is cleared", () => {
    const projectDirectory = setupProject("refreshed-browser-target", {
      name: "refreshed-browser-target",
      dependencies: { react: "^18.0.0" },
      browserslist: ["chrome 80"],
    });

    expect(
      getCapabilities(discoverProject(projectDirectory)).has(
        "target-blank-needs-explicit-protection",
      ),
    ).toBe(true);

    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "refreshed-browser-target",
        dependencies: { react: "^18.0.0" },
        browserslist: ["chrome 120"],
      }),
    );
    clearProjectCache();

    expect(
      getCapabilities(discoverProject(projectDirectory)).has(
        "target-blank-needs-explicit-protection",
      ),
    ).toBe(false);
  });

  it.each([
    ["android-browser", "android 4.4", "noreferrer"],
    ["kaios-legacy", "kaios 2.5", "noreferrer"],
    ["uc-android", "and_uc 15.5", "noopener"],
    ["qq-android", "and_qq 14.9", "noopener"],
    ["baidu-android", "baidu 13.52", "noopener"],
    ["edge-legacy", "edge 18", "noreferrer"],
    ["opera-mobile-legacy", "op_mob 12.1", undefined],
  ])("models explicit protection support for %s", (caseName, query, expected) => {
    const packageJson: PackageJson = {
      name: caseName,
      browserslist: [query],
    };
    const projectDirectory = setupProject(caseName, packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe(expected);
  });

  it.each([
    ["android-current", "android 150"],
    ["kaios-current", "kaios 3.0-3.1"],
    ["opera-mobile-current", "op_mob 80"],
  ])("recognizes implicit opener isolation for %s", (caseName, query) => {
    const packageJson: PackageJson = {
      name: caseName,
      browserslist: [query],
    };
    const projectDirectory = setupProject(caseName, packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBeUndefined();
  });

  it("keeps Opera Mini quiet because target does not create a new browsing context", () => {
    const packageJson: PackageJson = {
      name: "opera-mini",
      browserslist: ["op_mini all"],
    };
    const projectDirectory = setupProject("opera-mini", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBeUndefined();
  });

  it.each([
    ["chrome-before-noreferrer", "chrome 15"],
    ["firefox-before-noreferrer", "firefox 32"],
    ["edge-before-noreferrer", "edge 12"],
  ])("does not recommend an unsupported rel token for %s", (caseName, query) => {
    const packageJson: PackageJson = {
      name: caseName,
      browserslist: [query],
    };
    const projectDirectory = setupProject(caseName, packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBeUndefined();
  });

  it("retains actionable protection for mixed supported and unsupported targets", () => {
    const packageJson: PackageJson = {
      name: "mixed-ie-chrome",
      browserslist: ["ie 11", "chrome 80"],
    };
    const projectDirectory = setupProject("mixed-ie-chrome", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe("noopener");
  });

  it("requires noopener for Electron before Chromium 88", () => {
    const packageJson: PackageJson = {
      name: "electron-8",
      devDependencies: { electron: "8.2.3" },
    };
    const projectDirectory = setupProject("electron-8", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe("noopener");
  });

  it("requires noreferrer before Electron adopted Chromium 49", () => {
    const packageJson: PackageJson = {
      name: "electron-0-36",
      dependencies: { react: "^18.0.0" },
      devDependencies: { electron: "^0.36.0" },
    };
    const projectDirectory = setupProject("electron-0-36", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe("noreferrer");
    const capabilities = getCapabilities(discoverProject(projectDirectory));
    expect(capabilities.has("target-blank-needs-explicit-protection")).toBe(true);
    expect(capabilities.has("target-blank-needs-noreferrer")).toBe(true);
  });

  it("requires noopener once Electron adopted Chromium 49", () => {
    const packageJson: PackageJson = {
      name: "electron-0-37",
      devDependencies: { electron: "^0.37.0" },
    };
    const projectDirectory = setupProject("electron-0-37", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe("noopener");
  });

  it("uses the strongest actionable protection across browser and Electron targets", () => {
    const packageJson: PackageJson = {
      name: "chrome-80-electron-0-36",
      browserslist: ["chrome 80"],
      devDependencies: { electron: "^0.36.0" },
    };
    const projectDirectory = setupProject("chrome-80-electron-0-36", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBe("noreferrer");
  });

  it("keeps Electron 12 and newer ungated", () => {
    const packageJson: PackageJson = {
      name: "electron-12",
      devDependencies: { electron: "^12.0.0" },
    };
    const projectDirectory = setupProject("electron-12", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBeUndefined();
  });

  it("keeps invalid browserslist queries quiet", () => {
    const packageJson: PackageJson = {
      name: "invalid-query",
      browserslist: ["definitely-not-a-browser 1"],
    };
    const projectDirectory = setupProject("invalid-query", packageJson);

    expect(detectTargetBlankOpenerProtection(projectDirectory, packageJson)).toBeUndefined();
  });
});
