# react-doctor-rust

Experimental native Rust engine for React Doctor. It uses the same CLI, configuration, diagnostics, and suppressions as `react-doctor`.

```bash
npx react-doctor-rust@experimental .
```

This package intentionally fails when its native binding is unavailable, incompatible, or fails during analysis. Run `react-doctor` directly to use the stable TypeScript engine.

Supported targets are Linux x64/arm64 with glibc 2.28 or newer, macOS x64/arm64, and Windows x64. Linux musl is not supported.

The package bundles the exact React Doctor CLI and rule plugin used to validate its native engine. It does not require a separate stable `react-doctor` release. The matching platform binding is selected through an exact optional dependency. No Rust compiler is needed to install the package.

Use `react-doctor-rust` explicitly in scripts and CI. Generated Git hooks and agent hooks retain the canonical `react-doctor` command.

This is experimental software, with no general speedup claim. Some large projects hit existing analysis limits and produce incomplete reports. The native-command socket bridge rule remains outside the native port.

Before promoting an experimental release, its postpublish smoke must install only `react-doctor-rust@<exact-version>` and pass on every supported platform.
