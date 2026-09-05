import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeNativeSourceSha256 } from "../../../../../scripts/native/utils/compute-native-source-sha256.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sourcePaths = [
  ".github/workflows/native-oxlint.yml",
  "native/oxlint/upstream.json",
  "native/oxlint/react-doctor.patch",
  "native/oxlint/rules/example.rs",
  "native/oxlint/scans/example.rs",
  "native/oxlint/project-analysis/example.rs",
  "scripts/native/build-oxlint-binding.mjs",
  "scripts/native/utils/compute-native-source-sha256.mjs",
];

test("fingerprints every build input and tolerates checkout line endings", (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "native-source-provenance-"));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  for (const relativePath of sourcePaths) {
    const filePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "original\nsource\n");
  }
  const originalHash = computeNativeSourceSha256(fixtureRoot);
  for (const relativePath of sourcePaths) {
    const filePath = path.join(fixtureRoot, relativePath);
    fs.writeFileSync(filePath, "changed\nsource\n");
    assert.notEqual(computeNativeSourceSha256(fixtureRoot), originalHash, relativePath);
    fs.writeFileSync(filePath, "original\r\nsource\r\n");
    assert.equal(computeNativeSourceSha256(fixtureRoot), originalHash, relativePath);
  }
  const renamedPath = path.join(fixtureRoot, "native/oxlint/rules/renamed.rs");
  fs.renameSync(path.join(fixtureRoot, "native/oxlint/rules/example.rs"), renamedPath);
  assert.notEqual(computeNativeSourceSha256(fixtureRoot), originalHash);
  fs.rmSync(renamedPath);
  assert.notEqual(computeNativeSourceSha256(fixtureRoot), originalHash);
});

test("assembly rejects stale and legacy artifacts before replacing package output", (context) => {
  const artifactsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "native-stale-artifacts-"));
  const outputDirectory = fs.mkdtempSync(path.join(repositoryRoot, "tmp-native-provenance-"));
  context.after(() => {
    fs.rmSync(artifactsDirectory, { recursive: true, force: true });
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  });
  const sentinelPath = path.join(outputDirectory, "sentinel");
  fs.writeFileSync(sentinelPath, "preserved");
  const bindingFile = "oxlint-react-doctor.darwin-arm64.node";
  const bindingContent = "stale binding";
  fs.writeFileSync(path.join(artifactsDirectory, bindingFile), bindingContent);
  for (const sourceSha256 of [undefined, "outdated-native-source"]) {
    fs.writeFileSync(
      path.join(artifactsDirectory, `${bindingFile}.json`),
      JSON.stringify({
        bindingFile,
        bindingSha256: crypto.createHash("sha256").update(bindingContent).digest("hex"),
        sourceSha256,
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts/native/assemble-react-doctor-rust-packages.mjs"),
        "--artifacts",
        artifactsDirectory,
        "--output",
        outputDirectory,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /source SHA-256 mismatch/);
    assert.equal(fs.readFileSync(sentinelPath, "utf8"), "preserved");
  }
});
