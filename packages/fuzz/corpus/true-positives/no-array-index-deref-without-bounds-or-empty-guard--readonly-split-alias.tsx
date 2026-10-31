// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: alias-guard
// source: independently synthetic readonly split alias
// verdict: fail
export const SplitLabel = ({ text }: { text: string }) => {
  const pieces = text.split("~");
  return <span>{pieces[1].trim()}</span>;
};
