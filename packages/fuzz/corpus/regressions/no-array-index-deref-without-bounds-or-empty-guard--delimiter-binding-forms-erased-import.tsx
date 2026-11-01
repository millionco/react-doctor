// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
import type String = require("provider-types");
String.prototype.split = () => [];
export const readDelimitedLabel = (value: number) => {
  const text = value.toString();
  const position = text.indexOf(".");
  return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>;
};
