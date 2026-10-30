// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: fail
// weakness: control-flow
// source: independently authored readonly delimiter regression
export const DelimitedLabel = ({ value }: { value: string }) => {
  const text = value;
  const delimiterPosition = text.indexOf(":");
  return <span>{delimiterPosition !== -1 ? text.split(".")[1].length : 0}</span>;
};
