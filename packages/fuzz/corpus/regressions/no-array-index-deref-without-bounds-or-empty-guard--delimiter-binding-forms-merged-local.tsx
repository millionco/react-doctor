// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// weakness: provider-erasure
// source: independently synthetic binding namespace control
const String = { note: 0 };
interface String {}
String.note = 1;
export const readDelimitedLabel = (value: number) => {
  const text = value.toString();
  const position = text.indexOf(".");
  return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>;
};
