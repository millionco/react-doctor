# react-doctor-rust

Experimental native Rust engine for React Doctor. It uses the same CLI, configuration, diagnostics, and suppressions as `react-doctor`.

```bash
npx react-doctor-rust@experimental .
```

This package intentionally fails when its native binding is unavailable, incompatible, or fails during analysis. Run `react-doctor` directly to use the stable TypeScript engine.

A registry release depends on an already-published matching `react-doctor` version that supports required native execution. Before promoting an experimental release, its postpublish smoke must install only `react-doctor-rust@<exact-version>` and pass on every supported platform.
