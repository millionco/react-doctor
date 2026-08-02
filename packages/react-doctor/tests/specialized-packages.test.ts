import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";

interface SpecializedPackageExpectation {
  readonly packageName: string;
  readonly displayName: string;
}

interface SpecializedPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Record<string, string>;
}

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
const SPECIALIZED_PACKAGES: readonly SpecializedPackageExpectation[] = [
  { packageName: "tui-doctor", displayName: "TUI Doctor" },
  { packageName: "ui-doctor", displayName: "UI Doctor" },
  { packageName: "threejs-doctor", displayName: "Three.js Doctor" },
];

const readManifest = (packageName: string): SpecializedPackageManifest =>
  JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, "packages", packageName, "package.json"), "utf8"),
  );

describe("specialized doctor packages", () => {
  it("keeps every launcher synchronized with React Doctor", () => {
    const reactDoctorVersion = readManifest("react-doctor").version;
    for (const { packageName } of SPECIALIZED_PACKAGES) {
      const manifest = readManifest(packageName);
      expect(manifest.name).toBe(packageName);
      expect(manifest.version).toBe(reactDoctorVersion);
      expect(manifest.dependencies["react-doctor"]).toBe("workspace:*");
    }
  });

  it.each(SPECIALIZED_PACKAGES)(
    "brands $packageName without exposing broad React Doctor commands",
    ({ packageName, displayName }) => {
      const binaryPath = path.join(
        REPOSITORY_ROOT,
        "packages",
        packageName,
        "bin",
        `${packageName}.js`,
      );
      const result = spawnSync(process.execPath, [binaryPath, "--help", "--no-color"], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Usage: ${packageName}`);
      expect(result.stdout).toContain(displayName);
      expect(result.stdout).toContain("Runs React Doctor rules tagged");
      expect(result.stdout).not.toContain("experimental-lsp");
      expect(result.stdout).not.toContain("ci install");
    },
  );
});
