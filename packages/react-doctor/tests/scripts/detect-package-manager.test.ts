import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectPackageManager, hasReactDoctorInstalled } from "../../../../scripts/detect-package-manager.mjs";

describe("detect-package-manager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-pm-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detectPackageManager", () => {
    it("detects pnpm from packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.0.0" }),
      );
      expect(detectPackageManager(tempDir)).toBe("pnpm");
    });

    it("detects yarn from packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "yarn@4.0.0" }),
      );
      expect(detectPackageManager(tempDir)).toBe("yarn");
    });

    it("detects bun from packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "bun@1.0.0" }),
      );
      expect(detectPackageManager(tempDir)).toBe("bun");
    });

    it("detects npm from packageManager field", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "npm@10.0.0" }),
      );
      expect(detectPackageManager(tempDir)).toBe("npm");
    });

    it("detects pnpm from pnpm-lock.yaml", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      expect(detectPackageManager(tempDir)).toBe("pnpm");
    });

    it("detects yarn from yarn.lock", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
      fs.writeFileSync(path.join(tempDir, "yarn.lock"), "# yarn lockfile v1\n");
      expect(detectPackageManager(tempDir)).toBe("yarn");
    });

    it("detects bun from bun.lockb", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
      fs.writeFileSync(path.join(tempDir, "bun.lockb"), "");
      expect(detectPackageManager(tempDir)).toBe("bun");
    });

    it("detects npm from package-lock.json", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
      fs.writeFileSync(path.join(tempDir, "package-lock.json"), "{}");
      expect(detectPackageManager(tempDir)).toBe("npm");
    });

    it("defaults to npm when no package manager is detected", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
      expect(detectPackageManager(tempDir)).toBe("npm");
    });

    it("prefers packageManager field over lockfile", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.0.0" }),
      );
      fs.writeFileSync(path.join(tempDir, "yarn.lock"), "# yarn lockfile v1\n");
      expect(detectPackageManager(tempDir)).toBe("pnpm");
    });

    it("searches parent directories for packageManager field", () => {
      const subDir = path.join(tempDir, "packages", "app");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.0.0" }),
      );
      fs.writeFileSync(path.join(subDir, "package.json"), JSON.stringify({}));
      expect(detectPackageManager(subDir)).toBe("pnpm");
    });

    it("searches parent directories for lockfiles", () => {
      const subDir = path.join(tempDir, "packages", "app");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      fs.writeFileSync(path.join(subDir, "package.json"), JSON.stringify({}));
      expect(detectPackageManager(subDir)).toBe("pnpm");
    });
  });

  describe("hasReactDoctorInstalled", () => {
    it("returns true when react-doctor is in dependencies", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: { "react-doctor": "^2.0.0" } }),
      );
      expect(hasReactDoctorInstalled(tempDir)).toBe(true);
    });

    it("returns true when react-doctor is in devDependencies", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ devDependencies: { "react-doctor": "^2.0.0" } }),
      );
      expect(hasReactDoctorInstalled(tempDir)).toBe(true);
    });

    it("returns false when react-doctor is not installed", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ dependencies: {} }),
      );
      expect(hasReactDoctorInstalled(tempDir)).toBe(false);
    });

    it("returns false when package.json is missing", () => {
      expect(hasReactDoctorInstalled(tempDir)).toBe(false);
    });

    it("returns false when package.json is malformed", () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), "not valid json");
      expect(hasReactDoctorInstalled(tempDir)).toBe(false);
    });
  });
});
