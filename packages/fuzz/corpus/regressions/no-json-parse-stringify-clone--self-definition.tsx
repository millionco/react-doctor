// rule: no-json-parse-stringify-clone
// weakness: library-idiom
// source: independently authored public synthetic
// verdict: pass
global.structuredClone = jest.fn(function (value) {
  return JSON.parse(JSON.stringify(value));
});
