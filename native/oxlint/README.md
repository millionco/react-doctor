# Source-patched Oxlint

This directory contains a patch against one exact Oxc commit. It adds a `react-doctor-native` plugin while leaving the stock Oxlint JavaScript launcher and all unported React Doctor rules unchanged.

The native rule cohort is listed in `upstream.json`, with one Rust source file per rule in `rules/`. React Doctor enables those rules only when `REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH` points to a built `.node` binding. Without that environment variable, scans use the published Oxlint binding and JavaScript rules exactly as before.

## Build and verify

```sh
nr native:oxlint:verify
nr native:oxlint:check
nr native:oxlint:build
REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH=dist/native-oxlint/<binding>.node nr native:oxlint:parity
REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH=dist/native-oxlint/<binding>.node nr native:oxlint:parity --benchmark
REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH=dist/native-oxlint/<binding>.node nr native:oxlint:parity --corpus packages/fuzz/tmp/corpus-repos
```

Set `CARGO_BUILD_JOBS=1` and `CARGO_INCREMENTAL=0` for the compile-check and release build on memory-constrained builders.

`native:oxlint:verify` clones the pinned tag, checks its commit, and proves the patch still applies. `native:oxlint:check` overlays every native rule, regenerates Oxc's rule registry, and compile-checks the linter. `native:oxlint:build` performs the same source assembly, compiles and loads the N-API binding, and writes the binding plus provenance and SHA-256 hashes to `dist/native-oxlint`.

The parity check runs the JavaScript and native implementations over the same adversarial TypeScript fixture and compares normalized diagnostics. It also runs isolated cases from `fixtures/ast-parity-boundaries.json`, including multiple files in one process and cross-file parser limits. Each case pins the canonical diagnostic count and compares messages, severity, filenames, spans, and multiplicity; unexpected parser or plugin diagnostics fail the check. Pass `--corpus` with a directory of repositories to compare every repository independently. A native rule should not be added to `nativeRules` or `NATIVE_REACT_DOCTOR_RULE_IDS` until both checks pass.

The workflow builds artifacts for Linux x64/arm64, macOS x64/arm64, and Windows x64. It does not publish them. Shipping or making the native patch the default should happen only after corpus parity shows no diagnostic drift and benchmarks show at least a 15% p50 lint improvement.

## Experimental package

`react-doctor-rust` is a separate launcher for the source-patched binding. It does not change the `react-doctor` package, fails before startup when the matching native package is missing or incompatible, and exits on native analysis failures instead of falling back to TypeScript.

The native workflow builds, verifies, packages, and smoke-tests Linux glibc x64/arm64, macOS x64/arm64, and Windows x64 independently. Every platform runs exact fixture parity, native scan parity, and native project-analysis parity before its artifact can enter the package assembly job. The assembly job verifies the recorded binding and patch SHA-256 hashes and a fingerprint of the current native sources, upstream manifest, build generator, and native CI configuration. Stale artifacts require a rebuild, including artifacts created before source fingerprinting. The fingerprint normalizes checkout line endings across platforms. Assembly generates one optional platform package per target and emits packed tarballs plus `SHA256SUMS`. Each target then installs and scans with those exact tarballs on its native runner.

Both Linux architectures build in official PyPA `manylinux_2_28` containers to target glibc 2.28. These images use AlmaLinux 8; see the [manylinux image documentation](https://github.com/pypa/manylinux#manylinux_2_28-almalinux-8-based). The eight tarball smoke jobs cover both architectures on this baseline with Node 20.19.0, current Ubuntu runners, both macOS architectures, and Windows x64. Linux Cargo caches are isolated from host builds so newer glibc artifacts cannot enter the baseline build through the cache.

The package remains private and CI-only until a separately approved release workflow publishes it under the `experimental` npm tag. A release assembly must pass both `--version` and `--react-doctor-version`; that exact `react-doctor` version must already be published with required-native execution support. Publishing must remove `private` from the launcher and all platform packages, publish the five platform packages before the launcher, and preserve the shared version.

The packed CI smoke installs explicit local tarballs to validate their contents. After publishing, run `nr native:rust:smoke -- --package react-doctor-rust@<exact-version>` on every supported runner. That mode installs only the registry launcher, proving npm selects its current platform binding and resolves the compatible `react-doctor` dependency. Do not promote the experimental tag until every postpublish smoke passes. Musl and other targets are unsupported until they have native build and install smoke lanes.
