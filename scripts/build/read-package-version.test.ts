import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { readPackageVersion } from "../utils/read-package-version.js";

interface TestPackageManifest {
  readonly version: unknown;
}

const withPackageManifest = (
  manifest: TestPackageManifest,
  run: (moduleUrl: string) => void,
): void => {
  const packageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-build-policy-"));
  try {
    fs.writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(manifest));
    run(pathToFileURL(path.join(packageDirectory, "vite.config.ts")).href);
  } finally {
    fs.rmSync(packageDirectory, { recursive: true, force: true });
  }
};

test("readPackageVersion reads the package adjacent to a module URL", () => {
  withPackageManifest({ version: "1.2.3" }, (moduleUrl) => {
    assert.equal(readPackageVersion(moduleUrl), "1.2.3");
  });
});

test("readPackageVersion rejects manifests without a string version", () => {
  withPackageManifest({ version: 123 }, (moduleUrl) => {
    assert.throws(() => readPackageVersion(moduleUrl), /has no string version/);
  });
});
