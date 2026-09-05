# react-doctor-rust

Experimental native Rust engine for React Doctor. It uses the same CLI, configuration, diagnostics, and suppressions as `react-doctor`.

```bash
npx react-doctor-rust@experimental .
```

This package intentionally fails when its native binding is unavailable, incompatible, or fails during analysis. Run `react-doctor` directly to use the stable TypeScript engine.

Supported targets are Linux x64/arm64 with glibc 2.28 or newer, macOS x64/arm64, and Windows x64. Linux musl is not supported.

A registry release depends on an already-published matching `react-doctor` version that supports required native execution. Before promoting an experimental release, its postpublish smoke must install only `react-doctor-rust@<exact-version>` and pass on every supported platform.
