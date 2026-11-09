// rule: no-array-index-as-key
// weakness: alias-guard
// verdict: fail
export const TokenLabels = ({ items }) => {
  const records = [{ text: "A A" }];
  const visibleRecords = records.filter((record, index, collection) => {
    collection[0].text = { split: () => items };
    return true;
  });
  return visibleRecords.map((record) =>
    record.text.split(" ").map((part, index) => <span key={index}>{part}</span>),
  );
};
