// rule: no-array-find-result-member-access-without-guard
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (MongoDB cursor: collection.find(filter) is a query builder, not Array.prototype.find)
interface NodeCollection {
  find: (filter: object) => {
    sort: (order: object) => { limit: (count: number) => { toArray: () => Promise<object[]> } };
  };
}

export async function listNodes(collection: NodeCollection, sessionId: string, limit: number) {
  const filter = { session_id: sessionId };
  const docs = await collection.find(filter).sort({ created_at: 1, _id: 1 }).limit(limit).toArray();
  return docs;
}
