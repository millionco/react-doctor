// rule: no-json-parse-stringify-clone
// weakness: library-idiom
// source: independently authored public synthetic
// verdict: fail
export const duplicateValue = (value) => JSON.parse(JSON.stringify(value));
