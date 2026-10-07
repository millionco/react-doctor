// rule: no-json-parse-stringify-clone
// verdict: pass
// weakness: name-heuristic
// source: ReactBench semantic false positive
interface JsonRecord {
  createdAt: Date;
}

export const asJsonSafe = (value: JsonRecord): unknown => JSON.parse(JSON.stringify(value));
