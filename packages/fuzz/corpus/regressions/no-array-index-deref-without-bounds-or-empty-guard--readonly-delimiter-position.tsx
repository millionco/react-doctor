// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// weakness: control-flow
// source: independently authored readonly delimiter regression
export const readDelimitedLabel = (value: number) => {
  const text = value.toString();
  const delimiterPosition = text.indexOf(".");
  return <span>{delimiterPosition !== -1 ? text.split(".")[1].length : 0}</span>;
};
