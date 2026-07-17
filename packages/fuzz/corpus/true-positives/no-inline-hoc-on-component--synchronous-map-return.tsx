// rule: no-inline-hoc-on-component
// weakness: callback-provenance
// source: Bugbot review of PR #1339
const Row = ({ item }) => <div>{item.id}</div>;

export const Rows = withTracking(({ items }) => {
  useRows(items);
  return items.map((item) => <Row key={item.id} item={item} />);
});
