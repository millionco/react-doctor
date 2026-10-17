import type globalThis = require("types");
globalThis.structuredClone = replacement;
global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
