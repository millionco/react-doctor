import assert from "node:assert/strict";
import test from "node:test";
import {
  loadNativeBinding,
  resolveBindingPackageName,
  resolveLinuxLibc,
} from "../bin/resolve-native-binding.js";

const supportedTargets = [
  ["darwin", "arm64", "react-doctor-rust-binding-darwin-arm64"],
  ["darwin", "x64", "react-doctor-rust-binding-darwin-x64"],
  ["linux", "arm64", "react-doctor-rust-binding-linux-arm64-gnu", "gnu"],
  ["linux", "x64", "react-doctor-rust-binding-linux-x64-gnu", "gnu"],
  ["win32", "x64", "react-doctor-rust-binding-win32-x64-msvc"],
];

test("maps every supported platform to its binding package", () => {
  for (const [platform, architecture, packageName, linuxLibc] of supportedTargets) {
    assert.equal(resolveBindingPackageName(platform, architecture, linuxLibc), packageName);
  }
});

test("rejects unsupported platforms", () => {
  assert.throws(() => resolveBindingPackageName("freebsd", "x64"), /does not support freebsd-x64/);
  assert.throws(
    () => resolveBindingPackageName("linux", "x64", "musl"),
    /does not support linux-x64-musl/,
  );
});

test("distinguishes glibc from musl reports", () => {
  assert.equal(resolveLinuxLibc({ header: { glibcVersionRuntime: "2.39" } }), "gnu");
  assert.equal(resolveLinuxLibc({ header: {} }), "musl");
});

test("loads a complete binding", () => {
  const binding = {
    lint: () => undefined,
    scanReactDoctorFile: () => undefined,
    reactDoctorNativeScanRuleIds: () => [],
    analyzeReactDoctorProjectGraph: () => undefined,
    reactDoctorNativeProjectRuleIds: () => [],
    analyzeReactDoctorDuplicateJsx: () => undefined,
  };
  assert.equal(
    loadNativeBinding({
      platform: "darwin",
      architecture: "arm64",
      resolveModule: () => "/tmp/native.node",
      loadModule: () => binding,
      resolvePackageVersion: () => "0.0.0",
    }),
    "/tmp/native.node",
  );
});

test("rejects missing and incomplete bindings", () => {
  assert.throws(
    () =>
      loadNativeBinding({
        platform: "darwin",
        architecture: "arm64",
        resolveModule: () => {
          throw new Error("missing");
        },
        resolvePackageVersion: () => "0.0.0",
      }),
    /native package react-doctor-rust-binding-darwin-arm64 is missing/,
  );
  assert.throws(
    () =>
      loadNativeBinding({
        platform: "darwin",
        architecture: "arm64",
        resolveModule: () => "/tmp/native.node",
        loadModule: () => ({ lint: () => undefined }),
        resolvePackageVersion: () => "0.0.0",
      }),
    /missing scanReactDoctorFile\(\)/,
  );
  assert.throws(
    () =>
      loadNativeBinding({
        platform: "darwin",
        architecture: "arm64",
        resolvePackageVersion: () => "0.0.1",
      }),
    /is incompatible with react-doctor-rust@0\.0\.0/,
  );
});
