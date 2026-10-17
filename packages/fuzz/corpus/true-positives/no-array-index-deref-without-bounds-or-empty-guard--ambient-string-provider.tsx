// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: shadowed-binding
// source: independent synthetic review control
// verdict: fail

declare const String: any;
String.prototype.split = () => [];

export const ReadSegment = (input: string) => {
  const text = input;
  const position = text.indexOf(".");
  return position !== -1 ? text.split(".")[1].length : 0;
};
