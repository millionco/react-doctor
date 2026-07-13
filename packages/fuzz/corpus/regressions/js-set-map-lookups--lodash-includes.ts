// rule: js-set-map-lookups
// weakness: library-idiom
// source: React Bench cboard-org/cboard@06a34c2, Export.helpers.js:838

interface LodashCollection {
  includes: <Value>(values: readonly Value[], candidate: Value) => boolean;
}

export const collectNestedIds = (
  lodash: LodashCollection,
  tiles: readonly { id: string }[],
  nestedIds: string[],
): void => {
  tiles.forEach((tile) => {
    if (!lodash.includes(nestedIds, tile.id)) nestedIds.push(tile.id);
  });
};

export const collectZeroValues = (
  lodash: LodashCollection,
  rows: readonly number[][],
): number[][] => rows.filter((values) => lodash.includes(values, 0));
