# Source-patched Oxlint

This directory contains a patch against one exact Oxc commit. It adds a `react-doctor-native` plugin while leaving the stock Oxlint JavaScript launcher and all unported React Doctor rules unchanged.

The first native rule is `no-document-write`. React Doctor enables it only when `REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH` points to a built `.node` binding. Without that environment variable, scans use the published Oxlint binding and the JavaScript rule exactly as before.

## Build and verify

```sh
nr native:oxlint:verify
nr native:oxlint:build
REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH=dist/native-oxlint/<binding>.node nr native:oxlint:parity
REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH=dist/native-oxlint/<binding>.node nr native:oxlint:parity --benchmark
REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH=dist/native-oxlint/<binding>.node nr native:oxlint:parity --corpus packages/fuzz/tmp/corpus-repos
```

`native:oxlint:verify` clones the pinned tag, checks its commit, and proves the patch still applies. `native:oxlint:build` applies the patch in a temporary checkout, compiles and loads the N-API binding, and writes the binding plus provenance and SHA-256 hashes to `dist/native-oxlint`.

The parity check runs the JavaScript and native implementations over the same adversarial TypeScript fixture and compares normalized diagnostics. Pass `--corpus` with a directory of repositories to compare every repository independently. A native rule should not be added to `nativeRules` or `NATIVE_REACT_DOCTOR_RULE_IDS` until both checks pass.

The workflow builds artifacts for Linux x64/arm64, macOS x64/arm64, and Windows x64. It does not publish them. Shipping or making the native patch the default should happen only after corpus parity shows no diagnostic drift and benchmarks show at least a 15% p50 lint improvement.
