// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic API-role regression
// verdict: pass
const { useNitroApp: useWorkerApp } = await import("nitropack/runtime");

export const application = useWorkerApp();
