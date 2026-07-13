// rule: js-set-map-lookups
// weakness: library-idiom
// source: React Bench cboard-org/cboard@06a34c2, Export.helpers.js:838

interface LodashCollection {
  forEach: <Value>(values: readonly Value[], callback: (value: Value) => void) => void;
  includes: <Value>(values: readonly Value[], candidate: Value) => boolean;
}

export const collectNestedIds = (
  lodash: LodashCollection,
  tiles: readonly { id: string }[],
  nestedIds: string[],
): void => {
  lodash.forEach(tiles, (tile) => {
    if (!lodash.includes(nestedIds, tile.id)) nestedIds.push(tile.id);
  });
};
