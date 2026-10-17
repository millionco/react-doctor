// rule: no-non-null-assertion-on-maybe-undefined-result
// verdict: pass
// weakness: provider-erasure
// source: independently synthetic binding namespace control
const globalThis = { note: 0 };
interface globalThis {}
globalThis.note = 1;
const groups = new Map();
const selected = groups.get("group") ? groups.get("group")!.value : null;
