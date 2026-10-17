declare const globalThis: typeof global;
globalThis.structuredClone = replacement;
global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
