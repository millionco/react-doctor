// rule: no-json-parse-stringify-clone
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic constructor key beside erased type
const propertyName = "constructor";
interface propertyName {}
(() => {})[propertyName]("global = {}")();
global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
