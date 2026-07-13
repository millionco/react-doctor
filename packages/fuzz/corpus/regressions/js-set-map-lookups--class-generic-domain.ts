// rule: js-set-map-lookups
// weakness: type-provenance
// source: independent adversarial review of PR #1190

export class NumericCollection<Value extends number> {
  retain(candidates: Value[], allowedValues: Value[]): Value[] {
    return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
  }
}
