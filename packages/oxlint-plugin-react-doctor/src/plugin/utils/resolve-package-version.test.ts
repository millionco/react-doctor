import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { captureCrossFileProbes } from "./cross-file-probe-recorder.js";
import { resetManifestCaches } from "./read-nearest-package-manifest.js";
import { resolvePackageVersion } from "./resolve-package-version.js";

let fixtureDirectory = "";
let packageDirectory = "";
let filename = "";
let installedDirectory = "";
let installedManifestPath = "";
const supportedVersion = { major: 2, minor: 34, patch: 0, isPrerelease: false };
const declaredVersion = { version: supportedVersion, declaredRange: "^2.34.0" };
const installedVersion = { version: supportedVersion, declaredRange: null };
const strictOptions = { rejectInvalidResolvedManifest: true };

beforeEach(() => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-package-version-"));
  packageDirectory = path.join(fixtureDirectory, "project");
  filename = path.join(packageDirectory, "src", "source.tsx");
  installedDirectory = path.join(packageDirectory, "node_modules", "twilio-video");
  installedManifestPath = path.join(installedDirectory, "package.json");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.mkdirSync(installedDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({
      dependencies: { "twilio-video": "^2.34.0" },
    }),
  );
  resetManifestCaches();
});
afterEach(() => {
  resetManifestCaches();
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
});

describe("optional resolved-manifest validation", () => {
  it.each(["{", "null", "false", "12", '"invalid"'])(
    "keeps default fallback and independently rejects the resolved manifest %s",
    (manifestText) => {
      fs.writeFileSync(installedManifestPath, manifestText);
      expect(resolvePackageVersion(filename, "twilio-video")).toEqual(declaredVersion);
      expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
      expect(resolvePackageVersion(filename, "twilio-video", {})).toEqual(declaredVersion);
      expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
      expect(
        resolvePackageVersion(filename, "twilio-video", {
          rejectInvalidResolvedManifest: false,
        }),
      ).toEqual(declaredVersion);
    },
  );

  it("separates strict-first and default cache entries", () => {
    fs.writeFileSync(installedManifestPath, "null");
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(declaredVersion);
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
  });

  it.each(["{}", "[]", '{"version":"unknown"}'])(
    "preserves invalid-version object rejection in both modes for %s",
    (manifestText) => {
      fs.writeFileSync(installedManifestPath, manifestText);
      expect(resolvePackageVersion(filename, "twilio-video")).toBeNull();
      expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
    },
  );

  it("preserves installed and declared resolution in both modes", () => {
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(declaredVersion);
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toEqual(declaredVersion);
    fs.writeFileSync(installedManifestPath, '{"version":"2.34.0"}');
    resetManifestCaches();
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(installedVersion);
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toEqual(
      installedVersion,
    );
  });

  it("stops at an invalid nearer resolved manifest before a valid hoisted package", () => {
    const hoistedDirectory = path.join(fixtureDirectory, "node_modules", "twilio-video");
    fs.mkdirSync(hoistedDirectory, { recursive: true });
    fs.writeFileSync(path.join(hoistedDirectory, "package.json"), '{"version":"2.34.0"}');
    fs.writeFileSync(installedManifestPath, "null");
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(installedVersion);
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
    fs.unlinkSync(installedManifestPath);
    resetManifestCaches();
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toEqual(
      installedVersion,
    );
  });

  it("treats a resolved manifest directory as invalid without changing defaults", () => {
    fs.mkdirSync(installedManifestPath);
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(declaredVersion);
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
  });

  it.each(['{"version":"2.34.0"}', "null"])(
    "follows a manifest symlink with contents %s",
    (manifestText) => {
      const target = path.join(fixtureDirectory, "linked-manifest.json");
      fs.writeFileSync(target, manifestText);
      fs.symlinkSync(target, installedManifestPath);
      expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toEqual(
        manifestText === "null" ? null : installedVersion,
      );
    },
  );

  it("preserves the resolved-none equivalence of dangling and deleted symlinks", () => {
    fs.symlinkSync(path.join(fixtureDirectory, "missing-manifest.json"), installedManifestPath);
    const dangling = captureCrossFileProbes(() =>
      resolvePackageVersion(filename, "twilio-video", strictOptions),
    );
    fs.unlinkSync(installedManifestPath);
    resetManifestCaches();
    const deleted = captureCrossFileProbes(() =>
      resolvePackageVersion(filename, "twilio-video", strictOptions),
    );
    expect(dangling.value).toEqual(declaredVersion);
    expect(deleted.value).toEqual(dangling.value);
    expect(deleted.trace).toEqual(dangling.trace);
  });

  it("replays both content and resolved-entry probes for warm strict failures", () => {
    fs.writeFileSync(installedManifestPath, "null");
    const cold = captureCrossFileProbes(() =>
      resolvePackageVersion(filename, "twilio-video", strictOptions),
    );
    const warm = captureCrossFileProbes(() =>
      resolvePackageVersion(filename, "twilio-video", strictOptions),
    );
    expect(cold.value).toBeNull();
    expect(warm).toEqual(cold);
    expect(warm.trace.existencePaths.has(installedManifestPath)).toBe(true);
    expect(warm.trace.contentPaths.has(installedManifestPath)).toBe(true);
  });

  it("resets strict and default memo generations after manifest changes", () => {
    fs.writeFileSync(installedManifestPath, "null");
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toBeNull();
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(declaredVersion);
    fs.writeFileSync(installedManifestPath, '{"version":"2.34.0"}');
    resetManifestCaches();
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toEqual(
      installedVersion,
    );
    expect(resolvePackageVersion(filename, "twilio-video")).toEqual(installedVersion);
    fs.unlinkSync(installedManifestPath);
    resetManifestCaches();
    expect(resolvePackageVersion(filename, "twilio-video", strictOptions)).toEqual(declaredVersion);
  });
});
