// rule: js-set-map-lookups
// weakness: small-collection-and-fresh-allocation
// source: ReactBench RDFPFN792026 replay

interface LookupRow {
  value: string;
}

var __rest =
  (this && this.__rest) ||
  function (source, excluded) {
    var target = {};
    for (var property in source) {
      if (
        Object.prototype.hasOwnProperty.call(source, property) &&
        excluded.indexOf(property) < 0
      ) {
        target[property] = source[property];
      }
    }
    return target;
  };

export const omitSmallFixedLists = (first, second) => [
  __rest(first, ["children", "className"]),
  __rest(second, ["disabled"]),
];

export const retainFreshMatches = (rows: LookupRow[], selectedValues: string[]) =>
  rows.filter((row) => selectedValues.filter(Boolean).includes(row.value));
