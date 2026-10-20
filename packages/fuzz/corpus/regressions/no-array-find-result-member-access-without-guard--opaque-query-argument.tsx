// rule: no-array-find-result-member-access-without-guard
// verdict: pass
// weakness: library-idiom
// source: synthetic
interface RecordCursor {
  count: () => number;
}

interface RecordCollection {
  find: (criteria: object) => RecordCursor;
}

export const countRecords = (collection: RecordCollection, criteria: object) =>
  collection.find(criteria).count();
