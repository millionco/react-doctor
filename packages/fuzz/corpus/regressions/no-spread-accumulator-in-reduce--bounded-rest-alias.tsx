// rule: no-spread-accumulator-in-reduce
// weakness: alias-guard
// source: PR #1344 Bugbot review
export const mergeAll = (...objects: Record<string, unknown>[]) => {
  const boundedObjects = objects;
  return boundedObjects.reduce((accumulator, object) => ({ ...accumulator, ...object }), {});
};
