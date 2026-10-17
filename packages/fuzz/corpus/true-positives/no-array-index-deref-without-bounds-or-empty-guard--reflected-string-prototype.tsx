// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: alias-guard
// source: independent synthetic review control
// verdict: fail

Object.getPrototypeOf("").split = () => [];

export const ReadPart = (input: string) => {
  const text = input;
  const position = text.indexOf(".");
  return position !== -1 ? text.split(".")[1].length : 0;
};
