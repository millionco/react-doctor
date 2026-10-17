// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: shadowed-binding
// source: independent synthetic review control
// verdict: fail

declare const globalThis: any;
Object.defineProperty(globalThis.Map.prototype, "get", { value: () => undefined });

const groups = new Map();
export const selected = groups.get("group") ? groups.get("group")!.value : null;
