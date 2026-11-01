// rule: no-non-null-assertion-on-maybe-undefined-result
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
import type globalThis = require("provider-types");
globalThis.Map.prototype.get = () => undefined;
const groups = new Map();
const selected = groups.get("group") ? groups.get("group")!.value : null;
