// React Native build, published as `react-doctor/runtime` under the
// `react-native` condition. Re-exports the RN-safe perf harness, which connects
// only the DevTools backend (no `react-dom`/`fs`) so it bundles under Metro.
export * from "@react-doctor/perf-agent/native";
