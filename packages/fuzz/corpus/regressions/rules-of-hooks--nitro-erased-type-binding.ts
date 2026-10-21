// rule: rules-of-hooks
// weakness: type-value-namespace
// source: synthetic immutable Nitro getter regression
// verdict: pass
const { useNitroApp: useWorkerApp } = await import("nitropack/runtime");
type useWorkerApp = unknown;
export const application = useWorkerApp();
