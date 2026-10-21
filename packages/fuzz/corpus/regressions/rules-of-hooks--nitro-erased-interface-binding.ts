// rule: rules-of-hooks
// weakness: type-value-namespace
// source: synthetic immutable Nitro getter regression
// verdict: pass
const { useNitroApp } = await import("nitropack/runtime");
interface useNitroApp {}
export const application = useNitroApp();
